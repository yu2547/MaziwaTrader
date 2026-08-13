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

    constructor() {
        makeObservable(this, {
            access_token: observable,
            token_expires_at: observable,
            accounts: observable,
            selected_account_id: observable,
            is_authenticated: computed,
            selected_account: computed,
            balance: computed,
            currency: computed,
            account_id: computed,
            account_type: computed,
            setSession: action,
            setAccounts: action,
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

    get balance() {
        return this.selected_account?.balance ?? 0;
    }

    get currency() {
        return this.selected_account?.currency ?? '';
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

    selectAccount = (account_id: string) => {
        this.selected_account_id = account_id;
        storeSelectedAccountId(account_id);
    };

    clear = () => {
        this.access_token = '';
        this.token_expires_at = 0;
        this.accounts = [];
        this.selected_account_id = '';
    };
}
