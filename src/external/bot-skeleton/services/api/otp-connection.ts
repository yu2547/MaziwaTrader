import { getStoredAccessToken } from '@/utils/auth/deriv-oauth';
import {
    listOptionsAccounts,
    OptionsApiError,
    requestOptionsOtp,
    type TOptionsAccount,
} from '@/utils/options-trading/options-trading-api';
import { generateOtpApiInstance } from './appId';

/**
 * OTP transport factory - PHASE 1, STEP 1 of the additive OAuth -> REST ->
 * OTP -> WebSocket migration (see docs/DERIV_OAUTH_LEGACY_TOKEN_BRIDGE_REPORT.md
 * section 8). Deliberately isolated: this file does not import api-base.ts,
 * connection-manager.ts, or any tradeEngine/* module, and nothing outside
 * this file imports it yet. It exists to be reviewed and (later, manually)
 * exercised on its own before anything wires it into the live trade engine.
 *
 * What this proves once wired in: given an already-completed OAuth session
 * (src/utils/auth/deriv-oauth.ts) and an existing demo Options account, it
 * returns a live, OTP-authenticated WebSocket wrapped in the exact same
 * @deriv/deriv-api DerivAPIBasic + APIMiddleware construction the classic
 * transport uses (appId.js's generateDerivApiInstance) - so the object this
 * returns is structurally interchangeable with the classic one wherever
 * `.send()` / `.onMessage()` / `.connection` are used.
 *
 * What this deliberately does NOT do:
 * - Does not call `.authorize()` on the resulting instance, and does not
 *   construct or return anything shaped like a classic `authorize` response.
 *   The OTP already authenticates the connection at socket-open (confirmed
 *   live: an OTP-authenticated `balance` request succeeded immediately after
 *   open, no `authorize` message sent) - so there is nothing to fake here,
 *   and nothing here should be mistaken for classic auth state.
 * - Does not auto-create an account as a side effect of connecting.
 *   Account creation is a distinct, explicit action (createOptionsAccount in
 *   options-trading-api.ts) - silently creating one here would make
 *   "connect" have a surprising side effect once this factory is eventually
 *   called automatically on app load.
 */

export type TOtpApiInstance = ReturnType<typeof generateOtpApiInstance>;

export type TOtpConnectionResult = {
    // Explicit tag rather than relying on callers to infer transport from
    // shape - this is the "preserve the distinction internally" seam: any
    // code that receives this result can branch on `.transport` instead of
    // guessing whether it's holding a classic or OTP-backed connection.
    transport: 'otp';
    api: TOtpApiInstance;
    account: TOptionsAccount;
};

/**
 * Resolves once a fresh OTP-authenticated Options WebSocket has been
 * constructed. Throws OptionsApiError (never returns null) on any failure, so
 * callers can inspect `.kind` to decide how to react - in particular, no
 * stored OAuth session at all means "not an OTP-eligible session", which
 * callers should treat as a silent fall back to classic rather than an error
 * worth surfacing.
 *
 * Which account it connects to:
 *   preferred_account_id, when given and present in the list -> that account
 *   otherwise                                                -> accounts[0]
 *
 * accounts[0] is the same account oauth-session-store's `selected_account`
 * getter defaults to, so with no explicit preference the connection matches
 * whatever the header is displaying.
 *
 * This previously refused anything but a demo account. That was a deliberate
 * restriction while the transport was unproven, but it also meant a session
 * whose selected account is real silently fell through to the classic
 * connection - which cannot trade, so Run reported "Please login" while the
 * balance was on screen. It now follows the selected account, so REAL MONEY
 * IS REACHABLE HERE: whatever account this connects to is the account the bot
 * will place contracts against.
 *
 * Does not wait for the WebSocket's `open` event before resolving - this
 * mirrors generateDerivApiInstance()'s existing (classic) behavior exactly,
 * where the caller (ConnectionManager) owns attaching open/close listeners.
 * Keeping that asymmetry identical means a later "attach this instance to
 * ConnectionManager" step needs no special-casing for OTP vs classic.
 */
export const createOtpConnection = async (preferred_account_id?: string): Promise<TOtpConnectionResult> => {
    const access_token = getStoredAccessToken();
    if (!access_token) {
        throw new OptionsApiError(
            'accounts_fetch_failed',
            'No stored OAuth session found.',
            'createOtpConnection() requires a completed OAuth login (src/utils/auth/deriv-oauth.ts) before it can request an OTP.'
        );
    }

    const accounts = await listOptionsAccounts(access_token);
    const account = accounts.find(a => a.account_id === preferred_account_id) ?? accounts[0];
    if (!account) {
        throw new OptionsApiError(
            'no_options_account',
            'This login has no Options trading account yet.',
            'This factory deliberately does not create one - createOptionsAccount() in options-trading-api.ts is the explicit action for that.'
        );
    }

    const websocket_url = await requestOptionsOtp(access_token, account.account_id);
    const api = generateOtpApiInstance(websocket_url);

    return { transport: 'otp', api, account };
};
