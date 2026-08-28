import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { formatDate, isEnded } from '@/components/shared';
import { LogTypes } from '@/external/bot-skeleton';
import { ProposalOpenContract } from '@deriv/api-types';
import { TPortfolioPosition, TStores } from '@deriv/stores/types';
import { TContractInfo } from '../components/summary/summary-card.types';
import { transaction_elements } from '../constants/transactions';
import { getActiveAccountId } from '../utils/active-account-id';
import { getStoredItemsByKey, getStoredItemsByUser, setStoredItemsByKey } from '../utils/session-storage';
import RootStore from './root-store';

type TTransaction = {
    type: string;
    data?: string | TContractInfo;
};

type TElement = {
    [key: string]: TTransaction[];
};

export default class TransactionsStore {
    root_store: RootStore;
    core: TStores;
    disposeReactionsFn: () => void;

    constructor(root_store: RootStore, core: TStores) {
        this.root_store = root_store;
        this.core = core;
        this.is_transaction_details_modal_open = false;
        this.disposeReactionsFn = this.registerReactions();

        makeObservable(this, {
            elements: observable,
            active_transaction_id: observable,
            recovered_completed_transactions: observable,
            recovered_transactions: observable,
            is_called_proposal_open_contract: observable,
            is_transaction_details_modal_open: observable,
            transactions: computed,
            onBotContractEvent: action.bound,
            pushTransaction: action.bound,
            clear: action.bound,
            registerReactions: action.bound,
            recoverPendingContracts: action.bound,
            updateResultsCompletedContract: action.bound,
            sortOutPositionsBeforeAction: action.bound,
            recoverPendingContractsById: action.bound,
        });
    }
    TRANSACTION_CACHE = 'transaction_cache';

    elements: TElement = getStoredItemsByUser(this.TRANSACTION_CACHE, getActiveAccountId(this.core?.client), []);
    active_transaction_id: null | number = null;
    recovered_completed_transactions: number[] = [];
    recovered_transactions: number[] = [];
    is_called_proposal_open_contract = false;
    is_transaction_details_modal_open = false;

    get transactions(): TTransaction[] {
        // `elements` is read before the account id, and unconditionally, on
        // purpose: this getter is a MobX computed, and a computed tracks only
        // what it actually reads.
        //
        // The account id comes from the OTP handshake, which has not finished
        // when this is first evaluated on an OAuth session - so it was empty,
        // the ternary returned [] without ever touching `elements`, and the
        // cached [] was left with a dependency set of just client.loginid.
        // That never changes on OAuth, `elements` was not in the set so
        // pushTransaction could not invalidate it, and api_base is a plain
        // object so the arriving account id could not either. The cache stayed
        // poisoned for the whole session: Transactions and every statistic
        // read [] while the store filled up behind them.
        //
        // Touching `elements` first puts it in the dependency set on every
        // path, so any push invalidates this and the account id is re-read -
        // by which time the OTP account is populated.
        const elements = this.elements;
        const account_id = getActiveAccountId(this.core?.client);
        return account_id ? (elements[account_id] ?? []) : [];
    }

    get statistics() {
        let total_runs = 0;
        // Filter out only contract transactions and remove dividers
        const trxs = this.transactions.filter(
            trx => trx.type === transaction_elements.CONTRACT && typeof trx.data === 'object'
        );
        const statistics = trxs.reduce(
            (stats, { data }) => {
                const { profit, is_completed = false, buy_price, payout, bid_price } = data as TContractInfo;
                if (is_completed) {
                    // The Options API returns these as strings ("10.00"), so
                    // `+=` concatenated instead of adding: total_stake went
                    // 0 -> "010.00" -> "010.0010.00", which <Money> then
                    // rendered as 0.00.
                    //
                    // It hid well because every other reader coerces silently.
                    // `profit > 0` compares fine on a string, so won/lost and
                    // the run count stayed correct, and the rows print correctly
                    // through Math.abs() and <Money>. Only the running totals -
                    // the one place using `+=` on a field value - were wrong.
                    //
                    // Normalise once, here, and aggregate only numbers. `|| 0`
                    // covers undefined/null/NaN, so a field the API omits
                    // contributes nothing rather than poisoning the total.
                    const stake_value = Number(buy_price) || 0;
                    const profit_value = Number(profit) || 0;
                    // payout is absent on a loss; bid_price is the existing
                    // fallback and is kept exactly as it was.
                    const payout_value = Number(payout ?? bid_price) || 0;

                    if (profit_value > 0) {
                        stats.won_contracts += 1;
                        stats.total_payout += payout_value;
                    } else {
                        stats.lost_contracts += 1;
                    }
                    stats.total_profit += profit_value;
                    stats.total_stake += stake_value;
                    total_runs += 1;
                }
                return stats;
            },
            {
                lost_contracts: 0,
                number_of_runs: 0,
                total_profit: 0,
                total_payout: 0,
                total_stake: 0,
                won_contracts: 0,
            }
        );
        statistics.number_of_runs = total_runs;
        return statistics;
    }

    toggleTransactionDetailsModal = (is_open: boolean) => {
        this.is_transaction_details_modal_open = is_open;
    };

    onBotContractEvent(data: TContractInfo) {
        this.pushTransaction(data);
    }

    pushTransaction(data: TContractInfo) {
        const is_completed = isEnded(data as ProposalOpenContract);
        const { run_id } = this.root_store.run_panel;
        const current_account = getActiveAccountId(this.core?.client);

        const contract: TContractInfo = {
            ...data,
            is_completed,
            run_id,
            date_start: formatDate(data.date_start, 'YYYY-M-D HH:mm:ss [GMT]'),
            // The Options API sends the spots as entry_spot / exit_spot and
            // omits the *_tick_display_value fields these used to read, so both
            // cells rendered their loading skeleton forever - the row's
            // `?? <TransactionFieldLoader />` cannot tell "absent" from
            // "pending". Confirmed from a live settlement payload, which
            // carried entry_spot and exit_spot and neither display value.
            //
            // display_value is kept as the first choice where it exists: it is
            // pre-formatted to the symbol's pip size, whereas the raw spot is a
            // plain number. Classic sessions therefore render exactly as before
            // and only fall through to the spot when the field is missing.
            // The trailing `?? undefined` maps a null spot onto undefined: the
            // spots are nullable while these fields are not, and the row treats
            // undefined as "no value" already.
            entry_tick: data.entry_tick_display_value ?? data.entry_spot ?? undefined,
            entry_tick_time: data.entry_tick_time && formatDate(data.entry_tick_time, 'YYYY-M-D HH:mm:ss [GMT]'),
            exit_tick: data.exit_tick_display_value ?? data.exit_spot ?? undefined,
            exit_tick_time: data.exit_tick_time && formatDate(data.exit_tick_time, 'YYYY-M-D HH:mm:ss [GMT]'),
            profit: is_completed ? data.profit : 0,
        };

        // The getter above refuses to read a falsy key, and this writer used to
        // happily create an elements[''] bucket, so anything filed under ''
        // was written and could never be read back.
        //
        // That is now reachable. Recording the contract at
        // contract.purchase_received puts the first write earlier in the
        // session than the first proposal_open_contract, so it can land while
        // the OTP handshake is still settling and getActiveAccountId still
        // returns ''. Confirmed by driving the shipped store on the running
        // app: one push produced elements = { '': [...] } with
        // `transactions` still reporting 0 rows and the panel still showing
        // "There are no transactions to display".
        //
        // Refusing the write makes the two halves agree. Nothing is lost that
        // was not already lost: open-contract updates repeat for the life of a
        // contract, so the row is created by the next one after the account id
        // resolves, instead of being orphaned in a bucket nobody reads.
        if (!current_account) return;

        if (!this.elements[current_account]) {
            this.elements = {
                ...this.elements,
                [current_account]: [],
            };
        }

        const same_contract_index = this.elements[current_account]?.findIndex(c => {
            if (typeof c.data === 'string') return false;
            return (
                c.type === transaction_elements.CONTRACT &&
                c.data?.transaction_ids &&
                c.data.transaction_ids.buy === data.transaction_ids?.buy
            );
        });

        if (same_contract_index === -1) {
            // Render a divider if the "run_id" for this contract is different.
            if (this.elements[current_account]?.length > 0) {
                const temp_contract = this.elements[current_account]?.[0];
                const is_contract = temp_contract.type === transaction_elements.CONTRACT;
                const is_new_run =
                    is_contract &&
                    typeof temp_contract.data === 'object' &&
                    contract.run_id !== temp_contract?.data?.run_id;

                if (is_new_run) {
                    this.elements[current_account]?.unshift({
                        type: transaction_elements.DIVIDER,
                        data: contract.run_id,
                    });
                }
            }

            this.elements[current_account]?.unshift({
                type: transaction_elements.CONTRACT,
                data: contract,
            });
        } else {
            // If data belongs to existing contract in memory, update it.
            //
            // Merged rather than replaced, and undefined values in the incoming
            // payload are dropped. Two payload shapes reach the same row now -
            // the purchase stub (contract id, buy price, currency, type; no
            // spots and no profit yet) and the proposal_open_contract updates
            // that enrich it - and they can arrive in either order. A straight
            // replace meant whichever landed second won outright, so a
            // purchase response arriving after the first open-contract update
            // wiped the entry spot back to a loading skeleton.
            // Dropping undefined keys makes an update additive: a field is only
            // ever overwritten by another real value, never blanked by a
            // payload that simply does not carry it yet.
            const existing = this.elements[current_account]?.[same_contract_index]?.data;
            const has_existing = typeof existing === 'object' && !!existing;
            const merged = has_existing
                ? {
                      ...existing,
                      ...(Object.fromEntries(
                          Object.entries(contract).filter(([, value]) => value !== undefined)
                      ) as TContractInfo),
                  }
                : contract;

            // Dropping undefined keys is not enough on its own, because two
            // fields above are always written: is_completed is `false` and
            // profit is `0` for anything that is not itself a settlement. Both
            // are defined, so both survive the filter and overwrite.
            //
            // That matters for the one ordering where a contract settles before
            // its own buy response is handled. The late purchase stub was
            // un-settling a finished row - is_completed true -> false, profit
            // 1.08 -> 0 - and because `statistics` only counts completed
            // contracts, the row silently dropped out of the totals too: runs
            // and wins went back to 0 on a contract that had genuinely won.
            //
            // Settlement is one-way. Once a contract has ended, only its own
            // result describes it.
            if (has_existing && existing.is_completed && !is_completed) {
                merged.is_completed = true;
                merged.profit = existing.profit;
            }

            this.elements[current_account]?.splice(same_contract_index, 1, {
                type: transaction_elements.CONTRACT,
                data: merged,
            });
        }

        this.elements = { ...this.elements }; // force update
    }

    clear() {
        const account_id = getActiveAccountId(this.core?.client);
        if (this.elements && this.elements[account_id]?.length > 0) {
            this.elements[account_id] = [];
        }
        this.recovered_completed_transactions = this.recovered_completed_transactions?.slice(0, 0);
        this.recovered_transactions = this.recovered_transactions?.slice(0, 0);
        this.is_transaction_details_modal_open = false;
    }

    registerReactions() {
        const { client } = this.core;

        // Write transactions to session storage on each change in transaction elements.
        const disposeTransactionElementsListener = reaction(
            () => this.elements[getActiveAccountId(client)],
            elements => {
                const stored_transactions = getStoredItemsByKey(this.TRANSACTION_CACHE, {});
                stored_transactions[getActiveAccountId(client)] = elements?.slice(0, 5000) ?? [];
                setStoredItemsByKey(this.TRANSACTION_CACHE, stored_transactions);
            }
        );

        // User could've left the page mid-contract. On initial load, try
        // to recover any pending contracts so we can reflect accurate stats
        // and transactions.
        const disposeRecoverContracts = reaction(
            () => this.transactions.length,
            () => this.recoverPendingContracts()
        );

        return () => {
            disposeTransactionElementsListener();
            disposeRecoverContracts();
        };
    }

    recoverPendingContracts(contract = null) {
        this.transactions.forEach(({ data: trx }) => {
            if (
                typeof trx === 'string' ||
                trx?.is_completed ||
                !trx?.contract_id ||
                this.recovered_transactions.includes(trx?.contract_id)
            )
                return;
            this.recoverPendingContractsById(trx.contract_id, contract);
        });
    }

    updateResultsCompletedContract(contract: ProposalOpenContract) {
        const { journal, summary_card } = this.root_store;
        const { contract_info } = summary_card;
        const { currency, profit } = contract;

        if (contract.contract_id !== contract_info?.contract_id) {
            this.onBotContractEvent(contract);

            if (contract.contract_id && !this.recovered_transactions.includes(contract.contract_id)) {
                this.recovered_transactions.push(contract.contract_id);
            }
            if (
                contract.contract_id &&
                !this.recovered_completed_transactions.includes(contract.contract_id) &&
                isEnded(contract)
            ) {
                this.recovered_completed_transactions.push(contract.contract_id);

                journal.onLogSuccess({
                    log_type: profit && profit > 0 ? LogTypes.PROFIT : LogTypes.LOST,
                    extra: { currency, profit },
                });
            }
        }
    }

    sortOutPositionsBeforeAction(positions: TPortfolioPosition[], element_id?: number) {
        positions?.forEach(position => {
            if (!element_id || (element_id && position.id === element_id)) {
                const contract_details = position.contract_info;
                this.updateResultsCompletedContract(contract_details);
            }
        });
    }

    async recoverPendingContractsById(contract_id: number, contract: ProposalOpenContract | null = null) {
        // TODO: need to fix as the portfolio is not available now
        // const positions = this.core.portfolio.positions;
        const positions: unknown[] = [];

        if (contract) {
            this.is_called_proposal_open_contract = true;
            if (contract.contract_id === contract_id) {
                this.updateResultsCompletedContract(contract);
            }
        }

        if (!this.is_called_proposal_open_contract) {
            const current_account = getActiveAccountId(this.core?.client);
            if (current_account) {
                if (!this.elements[current_account]?.length) {
                    this.sortOutPositionsBeforeAction(positions);
                }

                const elements = this.elements[current_account];
                const [element = null] = elements;
                if (typeof element?.data === 'object' && !element?.data?.profit) {
                    const element_id = element.data.contract_id;
                    this.sortOutPositionsBeforeAction(positions, element_id);
                }
            }
        }
    }
}
