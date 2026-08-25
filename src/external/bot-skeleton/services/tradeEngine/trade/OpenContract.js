import { getRoundedNumber } from '@/components/shared';
import { localize } from '@deriv-com/translations';
import { config } from '../../../constants/config';
import { MessageTypes } from '../../../constants/messages';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { markTiming, reportTiming } from '../utils/run-timing';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    // The only emitter of 'bot.contract' - Transactions,
                    // Summary and the Journal are all fed from here.

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    this.setContractFlags(contract);

                    this.data.contract = contract;

                    // account_info has no loginid on the OTP transport - it
                    // carries account_id - and this runs inside an RxJS
                    // subscriber, where a TypeError would kill the
                    // subscription silently and stop every later update.
                    broadcastContract({
                        accountID: api_base.account_info?.loginid ?? api_base.account_info?.account_id,
                        ...contract,
                    });

                    if (this.isSold) {
                        markTiming('settled');
                        reportTiming();
                        this.contractId = '';
                        clearTimeout(this.transaction_recovery_timeout);
                        this.updateTotals(contract);

                        // Real results are what let Virtual Hook go back to
                        // watching. Counted here rather than at purchase,
                        // because only a settled contract has a result.
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
            });
            api_base.pushSubscription(subscription);
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
            return this.contractId && contractId === this.contractId;
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
