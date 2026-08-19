import { getRoundedNumber } from '@/components/shared';
import { runTrace } from '../../../utils/run-trace'; // TEMP-DIAGNOSTIC
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    // TEMP-DIAGNOSTIC: this is the only emitter of
                    // 'bot.contract', and Transactions/Summary/Journal are all
                    // fed by it. Two buys were accepted and no transaction was
                    // ever pushed, so either this message does not arrive on
                    // this transport or it is being filtered out below.
                    runTrace(
                        'C1. proposal_open_contract',
                        `id=${contract?.contract_id} expected=${this.contractId} match=${!!contract && this.expectedContractId(contract?.contract_id)}`,
                        8
                    );

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    this.setContractFlags(contract);

                    this.data.contract = contract;

                    // account_info has no loginid on the OTP transport - it
                    // carries account_id - and this runs inside an RxJS
                    // subscriber, where a TypeError would kill the
                    // subscription silently and stop every later update.
                    runTrace('C2. broadcasting contract', `sold=${this.isSold}`, 8);
                    broadcastContract({
                        accountID: api_base.account_info?.loginid ?? api_base.account_info?.account_id,
                        ...contract,
                    });

                    if (this.isSold) {
                        this.contractId = '';
                        clearTimeout(this.transaction_recovery_timeout);
                        this.updateTotals(contract);
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
