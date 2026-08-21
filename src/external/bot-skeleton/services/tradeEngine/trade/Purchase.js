// MAZIWA-EXEC (temporary diagnostic)
import { EXEC_STAGE, execTrace, execTraceFail } from '@/utils/exec-trace';
import { localize } from '@deriv-com/translations';
import { config } from '../../../constants/config';
import { LogTypes, MessageTypes } from '../../../constants/messages';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { markTiming } from '../utils/run-timing';
import { canEvaluateVirtually } from '../utils/virtual-hook-runner';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            // Virtual Hook: while it is watching, this contract is scored on
            // paper and no `buy` is sent. Returning to the before-purchase
            // scope afterwards puts the bot back here for the next tick,
            // without a contract ever existing - so nothing reaches
            // Transactions, Summary or the balance.
            if (this.virtual_hook?.isWatching()) {
                const { duration, duration_unit, prediction } = this.tradeOptions ?? {};
                if (canEvaluateVirtually(contract_type, duration_unit)) {
                    return this.runVirtualContract(contract_type, Number(duration) || 1, prediction);
                }
                this.virtual_hook.standDown(contract_type);
            }

            const onSuccess = response => {
                markTiming('buy_accepted');
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                // MAZIWA-EXEC (temporary diagnostic)
                execTrace(EXEC_STAGE.BUY_SUCCESS, {
                    contract_id: buy?.contract_id,
                    transaction_id: buy?.transaction_id,
                    buy_price: buy?.buy_price,
                    payout: buy?.payout,
                });

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { longcode: buy.longcode, transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => {
                    markTiming('buy_sent');
                    // MAZIWA-EXEC (temporary diagnostic)
                    execTrace(EXEC_STAGE.BUY_REQUEST, {
                        via: 'proposal_id',
                        proposal_id: id,
                        price: askPrice,
                        contract_type,
                    });
                    return api_base.api.send({ buy: id, price: askPrice });
                };

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    // MAZIWA-EXEC (temporary diagnostic) - rethrows, so the
                    // existing error handling downstream is unchanged.
                    return doUntilDone(action)
                        .then(onSuccess)
                        .catch(error => {
                            execTraceFail(EXEC_STAGE.BUY_FAILURE, {
                                via: 'proposal_id',
                                proposal_id: id,
                                code: error?.error?.code ?? error?.code,
                                message: error?.error?.message ?? error?.message,
                            });
                            throw error;
                        });
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // MAZIWA-EXEC (temporary diagnostic)
                        execTraceFail(EXEC_STAGE.BUY_FAILURE, {
                            via: 'proposal_id',
                            code: errorCode,
                            recovering: true,
                        });
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions, api_base.is_otp_transport);
            const action = () => {
                // MAZIWA-EXEC (temporary diagnostic)
                execTrace(EXEC_STAGE.BUY_REQUEST, {
                    via: 'parameters',
                    contract_type,
                    amount: this.tradeOptions?.amount,
                    currency: this.tradeOptions?.currency,
                });
                return api_base.api.send(trade_option);
            };

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                // MAZIWA-EXEC (temporary diagnostic) - rethrows, unchanged flow.
                return doUntilDone(action)
                    .then(onSuccess)
                    .catch(error => {
                        execTraceFail(EXEC_STAGE.BUY_FAILURE, {
                            via: 'parameters',
                            code: error?.error?.code ?? error?.code,
                            message: error?.error?.message ?? error?.message,
                        });
                        throw error;
                    });
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    // MAZIWA-EXEC (temporary diagnostic)
                    execTraceFail(EXEC_STAGE.BUY_FAILURE, { via: 'parameters', code: errorCode, recovering: true });
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }
        /**
         * Scores one paper contract off the live tick stream, then hands the
         * bot back to the before-purchase scope so the next tick is
         * considered. No request is sent and no contract is created.
         */
        async runVirtualContract(contract_type, duration, prediction) {
            const pip_size = this.getPipSize();

            // Raw, because the epoch is what marks "the tick we started from".
            // Seeding the baseline from the entry tick is the whole point: with
            // no baseline the first poll returns the tick that is already
            // there - the entry tick itself - and a one-tick contract would be
            // scored against its own entry. For rise/fall that is `X > X`,
            // false every time, so the hook would count losses that never
            // happened and commit real money early.
            const entry = await this.getLastTick(true).catch(() => null);
            if (!entry) return this.finishVirtualContract(null, contract_type);
            let last_epoch = entry.epoch;

            // Held per contract rather than on this.data, so two runs can never
            // inherit each other's position in the tick stream.
            const nextTick = () =>
                new Promise(resolve => {
                    let timer;
                    const poll = setInterval(async () => {
                        const tick = await this.getLastTick(true).catch(() => null);
                        if (!tick || tick.epoch === last_epoch) return;
                        clearInterval(poll);
                        clearTimeout(timer);
                        last_epoch = tick.epoch;
                        resolve(tick.quote);
                    }, 300);
                    // A stalled feed must not hold the bot here forever.
                    timer = setTimeout(() => {
                        clearInterval(poll);
                        resolve(null);
                    }, 60000);
                });

            const entry_tick = entry.quote;

            const is_win = await this.virtual_hook.score({
                contract_type,
                prediction,
                duration,
                pip_size,
                entry_tick,
                nextTick,
            });

            return this.finishVirtualContract(is_win, contract_type);
        }

        /**
         * Reports one virtual result and hands the bot back to the
         * before-purchase scope. Shared so every exit from a virtual contract -
         * scored, unscoreable, or no entry tick at all - returns control the
         * same way. An exit that forgot to REVERT would leave the bot sitting
         * in before-purchase with nothing driving it, which looks exactly like
         * the silent stall this engine has already been debugged for once.
         */
        finishVirtualContract(is_win, contract_type) {
            if (is_win === null) {
                // Could not be scored - stand down rather than invent a result.
                this.virtual_hook.standDown(contract_type);
            } else {
                // Its own journal line rather than a contract log type - this
                // is not a trade, and it must not read like one.
                globalObserver.emit('ui.log.notify', {
                    message: this.virtual_hook.isWatching()
                        ? localize('Virtual trade {{result}} - no money at risk.', {
                              result: is_win ? localize('won') : localize('lost'),
                          })
                        : localize('Virtual trade lost. Trading for real from the next entry.'),
                    message_type: MessageTypes.NOTIFY,
                    className: 'journal__text',
                    sound: config().lists.NOTIFICATION_SOUND[0][1],
                });
            }

            this.observer.emit('REVERT', 'before');
            return Promise.resolve();
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
