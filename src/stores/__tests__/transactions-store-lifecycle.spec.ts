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

// Mutable so one case can exercise the window before the account id resolves.
const account = { id: 'CR90001' };
jest.mock('../../utils/active-account-id', () => ({
    getActiveAccountId: () => account.id,
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

    describe('the purchase response opens the row, before any open-contract update', () => {
        /**
         * What run-panel-store.buildPurchaseTransaction() produces from a real
         * `buy` response. Only fields the Buy type actually carries, plus the
         * symbol/type decoded from the shortcode and the account currency -
         * no spots and no profit, because a purchase cannot know them.
         */
        const purchaseStub = (overrides: Record<string, unknown> = {}) => ({
            contract_id: CONTRACT_ID,
            transaction_ids: { buy: BUY_TRANSACTION_ID },
            buy_price: 2,
            payout: 3.08,
            currency: 'USD',
            underlying: '1HZ100V',
            contract_type: 'CALL',
            date_start: 1735689600,
            longcode: 'Win payout if...',
            shortcode: 'CALL_1HZ100V_3.08_1735689600_1735689900_S0P_0',
            ...overrides,
        });

        it('renders a row as soon as the purchase succeeds, with the spots still pending', () => {
            const store = makeStore();

            store.onBotContractEvent(purchaseStub() as never);

            // the panel must not still be saying "no transactions to display"
            expect(contractRows(store)).toHaveLength(1);
            const row = firstContract(store);
            expect(row.buy_price).toBe(2);
            expect(row.currency).toBe('USD');
            expect(row.underlying).toBe('1HZ100V');
            // pending, not invented
            expect(row.entry_tick).toBeUndefined();
            expect(row.exit_tick).toBeUndefined();
            expect(row.is_completed).toBe(false);
            // nothing has settled, so nothing is counted
            expect(store.statistics.number_of_runs).toBe(0);
        });

        it('case A - purchase then open-contract enriches the same row', () => {
            const store = makeStore();

            store.onBotContractEvent(purchaseStub() as never);
            store.onBotContractEvent(openContract({ entry_spot: 622.64 }) as never);

            expect(contractRows(store)).toHaveLength(1);
            expect(firstContract(store).entry_tick).toBe(622.64);
        });

        it('case B - open-contract first, and the later purchase must not blank the entry spot', () => {
            const store = makeStore();

            store.onBotContractEvent(openContract({ entry_spot: 622.64 }) as never);
            store.onBotContractEvent(purchaseStub() as never);

            expect(contractRows(store)).toHaveLength(1);
            // the purchase stub carries no entry spot; a straight replace would
            // have reset this cell to its loading skeleton
            expect(firstContract(store).entry_tick).toBe(622.64);
            expect(firstContract(store).buy_price).toBe(2);
        });

        it('case D - a contract that settles immediately still ends as one complete row', () => {
            const store = makeStore();

            store.onBotContractEvent(purchaseStub() as never);
            store.onBotContractEvent(
                openContract({
                    entry_spot: 622.64,
                    exit_spot: 623.24,
                    status: 'won',
                    is_sold: 1,
                    profit: '1.08',
                    payout: '3.08',
                }) as never
            );

            expect(contractRows(store)).toHaveLength(1);
            const row = firstContract(store);
            expect(row.is_completed).toBe(true);
            expect(row.entry_tick).toBe(622.64);
            expect(row.exit_tick).toBe(623.24);
            expect(store.statistics.number_of_runs).toBe(1);
            expect(store.statistics.won_contracts).toBe(1);
            expect(store.statistics.total_profit).toBeCloseTo(1.08, 10);
        });

        it('a contract that settles before its own buy response is handled stays settled', () => {
            const store = makeStore();

            // fast settle, slow buy response - the settlement lands first
            store.onBotContractEvent(
                openContract({
                    entry_spot: 622.64,
                    exit_spot: 623.24,
                    status: 'won',
                    is_sold: 1,
                    profit: '1.08',
                    payout: '3.08',
                }) as never
            );
            expect(firstContract(store).is_completed).toBe(true);
            expect(store.statistics.number_of_runs).toBe(1);

            // then the late purchase stub for the same contract arrives
            store.onBotContractEvent(purchaseStub() as never);

            // settlement is one-way: the stub must not un-settle the row, and
            // the contract must not drop out of the totals
            expect(contractRows(store)).toHaveLength(1);
            expect(firstContract(store).is_completed).toBe(true);
            expect(firstContract(store).exit_tick).toBe(623.24);
            expect(store.statistics.number_of_runs).toBe(1);
            expect(store.statistics.won_contracts).toBe(1);
            expect(store.statistics.total_profit).toBeCloseTo(1.08, 10);
        });

        it('does not orphan the contract into an unreadable bucket before the account id resolves', () => {
            const store = makeStore();
            account.id = '';

            try {
                // The purchase write is the earliest one in the session, so it
                // can land while the OTP handshake is still settling. The
                // getter refuses a falsy key, so anything filed under '' could
                // never be read back - the panel kept showing its empty state
                // with the contract sitting in the store.
                store.onBotContractEvent(purchaseStub() as never);
                expect(Object.keys(store.elements)).not.toContain('');
            } finally {
                account.id = ACCOUNT_ID;
            }

            // and the very next update, once the id is known, still builds the row
            store.onBotContractEvent(openContract({ entry_spot: 622.64 }) as never);
            expect(contractRows(store)).toHaveLength(1);
            expect(firstContract(store).entry_tick).toBe(622.64);
        });

        it('case C/§20 - three purchased contracts stay three rows, updated independently', () => {
            const store = makeStore();
            const ids = [
                { contract_id: 1, transaction_ids: { buy: 101 } },
                { contract_id: 2, transaction_ids: { buy: 102 } },
                { contract_id: 3, transaction_ids: { buy: 103 } },
            ];

            ids.forEach(id => store.onBotContractEvent(purchaseStub(id) as never));
            expect(contractRows(store)).toHaveLength(3);

            // updates arrive out of order, each must find its own row
            store.onBotContractEvent(openContract({ ...ids[2], entry_spot: 3.3 }) as never);
            store.onBotContractEvent(openContract({ ...ids[0], entry_spot: 1.1 }) as never);
            store.onBotContractEvent(openContract({ ...ids[1], entry_spot: 2.2 }) as never);

            expect(contractRows(store)).toHaveLength(3);
            const byBuyId = Object.fromEntries(
                contractRows(store).map(r => {
                    const d = r.data as Record<string, never>;
                    return [(d.transaction_ids as { buy: number }).buy, d.entry_tick];
                })
            );
            expect(byBuyId).toEqual({ 101: 1.1, 102: 2.2, 103: 3.3 });
        });
    });
});
