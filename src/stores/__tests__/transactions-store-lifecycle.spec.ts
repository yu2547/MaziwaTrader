/**
 * Drives one contract through its whole life -
 *   PURCHASED -> OPEN -> CONTRACT UPDATE -> WON/LOST -> SUMMARY
 * - against the real TransactionsStore, with the real payload shapes the
 * Options API sends. Nothing here replaces production logic: the store under
 * test is the one the app ships, and every assertion reads the same `elements`
 * / `transactions` / `statistics` members the Transactions panel and the
 * statistics tiles render from.
 *
 * The point is to cover the half of the flow a live session would otherwise be
 * the only way to see: that a row appears while the contract is still open
 * rather than at settlement, that later updates land on that same row instead
 * of stacking up new ones, and that the totals only count settled contracts.
 */
import { transaction_elements } from '../../constants/transactions';
import TransactionsStore from '../transactions-store';

const ACCOUNT_ID = 'CR90001';
const CONTRACT_ID = 111222333;
const BUY_TRANSACTION_ID = 987654321;

jest.mock('../../utils/active-account-id', () => ({
    getActiveAccountId: () => 'CR90001',
    getActiveAccountLabel: () => 'USD',
}));

jest.mock('../../utils/session-storage', () => ({
    getStoredItemsByKey: () => ({}),
    getStoredItemsByUser: () => ({}),
    setStoredItemsByKey: () => undefined,
}));

const makeStore = () => {
    const root_store = {
        run_panel: { run_id: 'run-1' },
        journal: { onLogSuccess: jest.fn() },
        summary_card: { contract_info: null },
    };
    const core = { client: { loginid: ACCOUNT_ID, currency: 'USD', account_list: [] } };
    return new TransactionsStore(root_store as never, core as never);
};

/** The shape OpenContract.js broadcasts on 'bot.contract'. */
const openContract = (overrides: Record<string, unknown> = {}) => ({
    accountID: ACCOUNT_ID,
    contract_id: CONTRACT_ID,
    transaction_ids: { buy: BUY_TRANSACTION_ID },
    underlying: '1HZ100V',
    contract_type: 'CALL',
    display_name: 'Volatility 100 (1s) Index',
    currency: 'USD',
    // strings on purpose - the Options API returns money fields as strings
    buy_price: '2.00',
    date_start: 1735689600,
    status: 'open',
    is_sold: 0,
    ...overrides,
});

const contractRows = (store: TransactionsStore) =>
    store.transactions.filter(t => t.type === transaction_elements.CONTRACT);

const firstContract = (store: TransactionsStore) => contractRows(store)[0]?.data as Record<string, unknown>;

describe('contract lifecycle through the production transactions store', () => {
    it('shows the row while the contract is still open, not only once it settles', () => {
        const store = makeStore();

        store.onBotContractEvent(openContract({ entry_spot: 622.64 }) as never);

        expect(contractRows(store)).toHaveLength(1);
        const row = firstContract(store);
        expect(row.is_completed).toBe(false);
        // entry spot is readable straight away; the exit cell stays pending
        expect(row.entry_tick).toBe(622.64);
        expect(row.exit_tick).toBeUndefined();
        // an open contract must not be counted as a result yet
        expect(store.statistics.number_of_runs).toBe(0);
        expect(store.statistics.total_stake).toBe(0);
    });

    it('updates the same row on later ticks instead of appending new ones', () => {
        const store = makeStore();

        store.onBotContractEvent(openContract({ entry_spot: 622.64 }) as never);
        store.onBotContractEvent(openContract({ entry_spot: 622.64, bid_price: '3.10' }) as never);
        store.onBotContractEvent(openContract({ entry_spot: 622.64, bid_price: '3.40' }) as never);

        expect(contractRows(store)).toHaveLength(1);
        expect(firstContract(store).bid_price).toBe('3.40');
    });

    it('settles a win: exit spot, profit and the summary totals all land', () => {
        const store = makeStore();

        store.onBotContractEvent(openContract({ entry_spot: 622.64 }) as never);
        store.onBotContractEvent(
            openContract({
                entry_spot: 622.64,
                exit_spot: 623.24,
                status: 'won',
                is_sold: 1,
                is_expired: 1,
                profit: '1.08',
                payout: '3.08',
                bid_price: '3.08',
            }) as never
        );

        expect(contractRows(store)).toHaveLength(1);
        const row = firstContract(store);
        expect(row.is_completed).toBe(true);
        expect(row.entry_tick).toBe(622.64);
        expect(row.exit_tick).toBe(623.24);
        expect(row.profit).toBe('1.08');

        const stats = store.statistics;
        expect(stats.number_of_runs).toBe(1);
        expect(stats.won_contracts).toBe(1);
        expect(stats.lost_contracts).toBe(0);
        // numbers, not concatenated strings
        expect(stats.total_stake).toBe(2);
        expect(stats.total_payout).toBe(3.08);
        expect(stats.total_profit).toBe(1.08);
    });

    it('settles a loss and keeps the totals numeric across mixed results', () => {
        const store = makeStore();

        store.onBotContractEvent(
            openContract({
                entry_spot: 622.85,
                exit_spot: 622.5,
                status: 'lost',
                is_sold: 1,
                is_expired: 1,
                profit: '-2.00',
                bid_price: '0.00',
            }) as never
        );
        store.onBotContractEvent(
            openContract({
                contract_id: CONTRACT_ID + 1,
                transaction_ids: { buy: BUY_TRANSACTION_ID + 1 },
                entry_spot: 623.24,
                exit_spot: 624.0,
                status: 'won',
                is_sold: 1,
                is_expired: 1,
                buy_price: '4.00',
                profit: '2.15',
                payout: '6.15',
                bid_price: '6.15',
            }) as never
        );

        const stats = store.statistics;
        expect(stats.number_of_runs).toBe(2);
        expect(stats.won_contracts).toBe(1);
        expect(stats.lost_contracts).toBe(1);
        expect(stats.total_stake).toBe(6);
        // a loss contributes no payout
        expect(stats.total_payout).toBe(6.15);
        expect(stats.total_profit).toBeCloseTo(0.15, 10);
        // every total must be a number - the string-concatenation bug this
        // guards against still produced a value, just the wrong kind
        Object.values(stats).forEach(value => expect(typeof value).toBe('number'));
    });

    it('clears back to an empty panel and zeroed totals on Reset', () => {
        const store = makeStore();

        store.onBotContractEvent(
            openContract({ exit_spot: 623.24, status: 'won', is_sold: 1, profit: '1.08', payout: '3.08' }) as never
        );
        expect(contractRows(store)).toHaveLength(1);

        store.clear();

        expect(contractRows(store)).toHaveLength(0);
        expect(store.statistics.number_of_runs).toBe(0);
        expect(store.statistics.total_profit).toBe(0);
    });
});
