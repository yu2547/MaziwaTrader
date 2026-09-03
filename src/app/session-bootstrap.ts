import { api_base } from '@/external/bot-skeleton';
import RootStore from '@/stores/root-store';
import { restoreStoredSession } from '@/utils/auth/deriv-oauth';
import { listOptionsAccounts } from '@/utils/options-trading/options-trading-api';

/**
 * The two things that have to happen once per page load before this app can
 * trade at all: the stored OAuth session is read back into oauth_session, and
 * the trading connection is opened.
 *
 * Both used to live in app-root.tsx, which React Router mounts only on the
 * index route - so opening or refreshing any other route (/manual, /dtrader,
 * /bulk-trader, /copy-trading...) restored no session and opened no
 * connection. The page then looked signed out to itself: "Account required"
 * beside the trade panel and a Run button that could not be pressed, while the
 * access token sat untouched in sessionStorage.
 *
 * Kept in module-level promises rather than component state so that the shell
 * and the index route can both ask for it and it still happens exactly once.
 * Neither function rejects: a failure here leaves the app in the state it
 * would have been in anyway, and every caller only wants to know it is over.
 */

let oauth_restore: Promise<void> | null = null;
let api_init: Promise<void> | null = null;
let oauth_restore_complete = false;
let api_initialized = false;

/**
 * Whether each step has already finished, so a component mounting after the
 * fact starts in the finished state instead of flashing through the loading
 * one again.
 */
export const getBootstrapState = () => ({
    is_api_initialized: api_initialized,
    is_oauth_restore_complete: oauth_restore_complete,
});

export const restoreOAuthSession = (store: RootStore): Promise<void> => {
    if (!oauth_restore) {
        oauth_restore = (async () => {
            try {
                const restored = restoreStoredSession();
                if (!restored || store.oauth_session.is_authenticated) return;

                store.oauth_session.setSession(restored.access_token, restored.expires_in);
                try {
                    store.oauth_session.setAccounts(await listOptionsAccounts(restored.access_token));
                } catch (error) {
                    // Non-fatal: the session itself is still valid even if the
                    // accounts list could not be refreshed right now.
                    console.error('[MW-AUTH] failed to refresh Options accounts on restore:', error); // eslint-disable-line no-console
                }
            } finally {
                oauth_restore_complete = true;
            }
        })();
    }
    return oauth_restore;
};

export const initTradingApi = (): Promise<void> => {
    if (!api_init) {
        api_init = api_base
            .init()
            .catch((error: unknown) => {
                console.error('API initialization failed:', error); // eslint-disable-line no-console
            })
            .then(() => {
                api_initialized = true;
            });
    }
    return api_init;
};
