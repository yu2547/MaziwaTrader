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
                    return api_base.api.send({ buy: id, price: askPrice });
                };

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
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
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
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
            const entry_tick = await this.getLastTick();

            const nextTick = () =>
                new Promise(resolve => {
                    const previous = this.data?.virtual_last_epoch;
                    const poll = setInterval(async () => {
                        const tick = await this.getLastTick(true).catch(() => null);
                        if (!tick || tick.epoch === previous) return;
                        clearInterval(poll);
                        if (this.data) this.data.virtual_last_epoch = tick.epoch;
                        resolve(tick.quote);
                    }, 400);
                    // A stalled feed must not hold the bot here forever.
                    setTimeout(() => {
                        clearInterval(poll);
                        resolve(null);
                    }, 60000);
                });

            const is_win = await this.virtual_hook.score({
                contract_type,
                prediction,
                duration,
                pip_size,
                entry_tick,
                nextTick,
            });

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
