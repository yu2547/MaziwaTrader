import { getRoundedNumber } from '@/components/shared';
import { localize } from '@deriv-com/translations';
import { config } from '../../../constants/config';
import { MessageTypes } from '../../../constants/messages';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { markTiming, reportTiming } from '../utils/run-timing';
import { openContractReceived, sell } from './state/actions';

/**
 * How long a bought contract may go without a single update before the engine
 * asks Deriv for it directly.
 *
 * Deriv pushes proposal_open_contract on every tick while a contract is open -
 * every second on a 1s index, every two on the rest - so six seconds of silence
 * is not a slow market, it is a stream that is not reaching this engine. That
 * happens when the socket is replaced mid-contract: the new socket's
 * all-contracts subscription only reports contracts that are still open, so one
 * that settled during the swap is never reported at all, and the run waited on
 * it for ever with the money already settled on Deriv's side.
 */
const CONTRACT_SILENCE_MS = 6000;

/** How long the direct request may go unanswered before the next check tries again. */
const CONTRACT_QUERY_TIMEOUT_MS = 8000;

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    this.onOpenContract(data.proposal_open_contract);
                }
            });
            api_base.pushSubscription(subscription);
        }

        /**
         * One update for the contract this engine bought, from the stream or from
         * the watchdog's direct request below - the same handling either way.
         *
         * Safe to receive twice. A direct request's answer also arrives on the
         * socket's message stream, so when the stream listener is alive it sees
         * the update first; the settled case clears contractId, and the second
         * copy is then ignored by expectedContractId.
         */
        onOpenContract(contract) {
            // The only emitter of 'bot.contract' - Transactions,
            // Summary and the Journal are all fed from here.

            if (!contract || !this.expectedContractId(contract?.contract_id)) {
                return;
            }

            this.last_contract_update_at = Date.now();
            this.setContractFlags(contract);

            this.data.contract = contract;

            // account_info has no loginid on the OTP transport - it carries
            // account_id - and this runs inside an RxJS subscriber, where a
            // TypeError would kill the subscription silently and stop every
            // later update.
            broadcastContract({
                accountID: api_base.account_info?.loginid ?? api_base.account_info?.account_id,
                ...contract,
            });

            if (this.isSold) {
                markTiming('settled');
                reportTiming();
                this.contractId = '';
                this.stopContractWatchdog();
                clearTimeout(this.transaction_recovery_timeout);
                this.updateTotals(contract);

                // Real results are what let Virtual Hook go back to watching.
                // Counted here rather than at purchase, because only a settled
                // contract has a result.
                if (this.virtual_hook?.recordRealResult(Number(contract.profit) > 0)) {
                    globalObserver.emit('ui.log.notify', {
                        message: localize('Virtual Hook re-armed - watching again before the next real trade.'),
                        message_type: MessageTypes.NOTIFY,
                        className: 'journal__text',
                        sound: config().lists.NOTIFICATION_SOUND[0][1],
                    });
                }
                contractStatus({
                    id: 'contract.sold',
                    data: contract.transaction_ids.sell,
                    contract,
                });

                if (this.afterPromise) {
                    this.afterPromise();
                }

                this.store.dispatch(sell());
            } else {
                this.store.dispatch(openContractReceived());
            }
        }

        /**
         * Guards a bought contract against never hearing back. Called once the
         * buy is confirmed.
         *
         * While updates keep arriving this does nothing but reschedule itself.
         * After CONTRACT_SILENCE_MS without one it asks Deriv for this contract
         * by id and hands the answer to onOpenContract, and keeps doing so every
         * CONTRACT_SILENCE_MS until the contract settles - so a run can no longer
         * sit on "Contract bought" for ever, whatever became of the stream.
         * What it reads back is Deriv's own record of the contract; nothing is
         * inferred or filled in.
         *
         * It lives only as long as the run: the first call registers it with
         * api_base like the stream listeners, so stopping the bot, which clears
         * those, clears this too.
         */
        startContractWatchdog() {
            this.stopContractWatchdog();
            const contract_id = this.contractId;
            if (!contract_id) return;

            if (!this.is_contract_watchdog_registered) {
                this.is_contract_watchdog_registered = true;
                // Permanent: a stopped run's engine is discarded, and a direct
                // request still in flight at the moment of stopping must not
                // start the checks up again when it comes back.
                api_base.pushSubscription({
                    unsubscribe: () => {
                        this.is_contract_watchdog_cancelled = true;
                        this.stopContractWatchdog();
                    },
                });
            }
            if (this.is_contract_watchdog_cancelled) return;

            this.last_contract_update_at = Date.now();
            this.has_reported_contract_silence = false;

            const schedule = delay_ms => {
                this.contract_watchdog = setTimeout(check, delay_ms);
            };
            const check = () => {
                this.contract_watchdog = null;
                if (!this.expectedContractId(contract_id)) return;

                const silent_for = Date.now() - this.last_contract_update_at;
                if (silent_for < CONTRACT_SILENCE_MS) {
                    schedule(CONTRACT_SILENCE_MS - silent_for);
                    return;
                }

                // Said once per contract, so the journal records that the
                // stream went quiet without repeating itself every few seconds.
                if (!this.has_reported_contract_silence) {
                    this.has_reported_contract_silence = true;
                    globalObserver.emit('ui.log.notify', {
                        message: localize(
                            'No update for contract {{contract_id}} in {{seconds}}s - asking Deriv for it directly.',
                            { contract_id, seconds: Math.round(CONTRACT_SILENCE_MS / 1000) }
                        ),
                        message_type: MessageTypes.NOTIFY,
                        className: 'journal__text',
                        sound: config().lists.NOTIFICATION_SOUND[0][1],
                    });
                }

                this.queryOpenContract(contract_id).finally(() => {
                    if (
                        !this.is_contract_watchdog_cancelled &&
                        this.expectedContractId(contract_id) &&
                        !this.contract_watchdog
                    ) {
                        schedule(CONTRACT_SILENCE_MS);
                    }
                });
            };

            schedule(CONTRACT_SILENCE_MS);
        }

        stopContractWatchdog() {
            if (this.contract_watchdog) {
                clearTimeout(this.contract_watchdog);
                this.contract_watchdog = null;
            }
        }

        /**
         * Reads one contract from Deriv on whichever socket is live now, and
         * hands it to onOpenContract.
         *
         * Bounded, because a request on a socket that has just died is never
         * answered or rejected by @deriv/deriv-api - it would wait for ever,
         * which is the very thing this exists to prevent. A timeout or a refusal
         * leaves the contract open here; the watchdog asks again on its next
         * check, by which time a replaced socket is usually up.
         */
        queryOpenContract(contract_id) {
            const api = api_base.api;
            if (!api) return Promise.resolve();

            let timer;
            const timeout = new Promise(resolve => {
                timer = setTimeout(resolve, CONTRACT_QUERY_TIMEOUT_MS);
            });
            const request = Promise.resolve(api.send({ proposal_open_contract: 1, contract_id })).then(response =>
                this.onOpenContract(response?.proposal_open_contract)
            );

            return Promise.race([request, timeout])
                .catch(error => {
                    // Deriv's own reason, in the journal once per contract - a
                    // refusal repeated every few seconds would bury the rest.
                    if (this.has_reported_contract_query_error === contract_id) return;
                    this.has_reported_contract_query_error = contract_id;
                    globalObserver.emit(
                        'ui.log.error',
                        localize('Could not read contract {{contract_id}} from Deriv: {{message}}', {
                            contract_id,
                            message: error?.error?.message ?? error?.message ?? String(error),
                        })
                    );
                })
                .finally(() => clearTimeout(timer));
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;

            this.isSold = Boolean(is_sold);
            this.isSellAvailable = !this.isSold && Boolean(is_valid_to_sell);
            this.isExpired = Boolean(is_expired);
            this.hasEntryTick = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            // Compared as text. The id arrives from the buy reply, the stream
            // and the direct request below, and a number on one side and a
            // string on the other would fail a strict comparison without a
            // word - every update for the contract ignored, which is this
            // engine's hang all over again.
            if (!this.contractId || contractId === undefined || contractId === null) return false;
            return String(contractId) === String(this.contractId);
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
