import { action, computed, makeObservable, observable } from 'mobx';
import { getStoredSelectedAccountId, storeSelectedAccountId } from '@/utils/auth/deriv-oauth';
import type { TOptionsAccount } from '@/utils/options-trading/options-trading-api';

/**
 * Authenticated-session state for the OAuth + Options API login path
 * (src/utils/auth/deriv-oauth.ts, src/utils/options-trading/options-trading-api.ts).
 *
 * Deliberately separate from ClientStore, which is keyed entirely on legacy
 * `loginid`/`acct1`/`token1` data from AuthWrapper.tsx - that model has no
 * field that an Options account (`account_id`, no `loginid`) maps onto
 * without fabricating data. This store is the source of truth for anything
 * that only needs the OAuth session + Options account list; it does not
 * read or write any legacy token/localStorage key.
 */
export default class OAuthSessionStore {
    access_token = '';
    token_expires_at = 0;
    accounts: TOptionsAccount[] = [];
    selected_account_id = '';

    // Live values from the account's `balance` stream on the authenticated
    // socket. null means "not received yet" - deliberately not 0, which the
    // header would have shown as a real balance.
    live_balance: number | null = null;
    live_currency = '';

    constructor() {
        makeObservable(this, {
            access_token: observable,
            token_expires_at: observable,
            accounts: observable,
            selected_account_id: observable,
            live_balance: observable,
            live_currency: observable,
            is_authenticated: computed,
            selected_account: computed,
            balance: computed,
            currency: computed,
            account_id: computed,
            account_type: computed,
            setSession: action,
            setAccounts: action,
            setLiveBalance: action,
            clearLiveBalance: action,
            selectAccount: action,
            clear: action,
        });
    }

    get is_authenticated() {
        return !!this.access_token;
    }

    get selected_account(): TOptionsAccount | null {
        return (
            this.accounts.find(account => account.account_id === this.selected_account_id) ?? this.accounts[0] ?? null
        );
    }

    /**
     * The balance to display, or null when there is genuinely nothing to show
     * yet - never 0 standing in for "unknown".
     *
     * Two real sources, in order of freshness:
     *   live_balance   - the account's `balance` stream on the authenticated
     *                    socket, updated whenever Deriv sends a change.
     *   selected_account.balance - the snapshot the REST account list carried
     *                    at login. Real, but taken once and never updated.
     *
     * Before this, only the second existed: the header rendered a login-time
     * snapshot for the rest of the session, and `?? 0` turned "no snapshot
     * yet" into a confident 0.00.
     */
    get balance(): number | null {
        if (this.live_balance !== null) return this.live_balance;
        const snapshot = this.selected_account?.balance;
        return typeof snapshot === 'number' ? snapshot : null;
    }

    get currency() {
        return this.live_currency || this.selected_account?.currency || '';
    }

    get account_id() {
        return this.selected_account?.account_id ?? '';
    }

    get account_type() {
        return this.selected_account?.account_type ?? '';
    }

    setSession = (access_token: string, expires_in: number) => {
        this.access_token = access_token;
        this.token_expires_at = Date.now() + expires_in * 1000;
    };

    setAccounts = (accounts: TOptionsAccount[]) => {
        this.accounts = accounts;
        if (!this.selected_account_id && accounts.length) {
            // Restore the account the user last picked, so a refresh doesn't
            // silently move the header (and the bot's trading account) back to
            // accounts[0]. api_base reads the same stored id on load.
            const stored_id = getStoredSelectedAccountId();
            const restored = accounts.find(account => account.account_id === stored_id);
            this.selected_account_id = (restored ?? accounts[0]).account_id;
        }
    };

    /**
     * Called only with values taken straight off a `balance` message from the
     * authenticated socket. Guarded so a message in an unexpected shape
     * leaves the header in its loading state rather than printing something
     * that was never a balance.
     */
    setLiveBalance = (balance: unknown, currency: unknown) => {
        const value = typeof balance === 'string' ? Number(balance) : balance;
        if (typeof value !== 'number' || Number.isNaN(value)) return;
        this.live_balance = value;
        if (typeof currency === 'string' && currency) this.live_currency = currency;
    };

    /** Back to "not received yet" - used when the account or socket changes. */
    clearLiveBalance = () => {
        this.live_balance = null;
        this.live_currency = '';
    };

    selectAccount = (account_id: string) => {
        this.selected_account_id = account_id;
        storeSelectedAccountId(account_id);
        // The live figure belongs to the account that was connected a moment
        // ago; showing it beside the newly selected one would be wrong.
        this.clearLiveBalance();
    };

    clear = () => {
        this.access_token = '';
        this.token_expires_at = 0;
        this.accounts = [];
        this.selected_account_id = '';
        this.clearLiveBalance();
    };
}
