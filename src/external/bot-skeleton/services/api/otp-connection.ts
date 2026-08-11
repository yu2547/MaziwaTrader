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
 * - Does not select or touch a real-money account. Only ever looks for an
 *   existing demo Options account. This is a Phase 1 scope decision, not an
 *   oversight: this transport has not yet been validated end-to-end, so it
 *   must not be reachable for real accounts until that validation is done.
 * - Does not auto-create a demo account as a side effect of connecting.
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
 * constructed for the caller's demo account. Throws OptionsApiError (never
 * returns null) on any failure, so callers can inspect `.kind` to decide how
 * to react - in particular:
 *   - no stored OAuth session at all -> callers should treat this as "not an
 *     OTP-eligible session" and fall back to classic silently, not as an
 *     error worth surfacing to the user.
 *   - 'no_demo_account' -> a real, actionable state (no demo Options account
 *     exists yet) that's worth surfacing, distinct from a network/API
 *     failure.
 *
 * Does not wait for the WebSocket's `open` event before resolving - this
 * mirrors generateDerivApiInstance()'s existing (classic) behavior exactly,
 * where the caller (ConnectionManager) owns attaching open/close listeners.
 * Keeping that asymmetry identical means a later "attach this instance to
 * ConnectionManager" step needs no special-casing for OTP vs classic.
 */
export const createOtpConnection = async (): Promise<TOtpConnectionResult> => {
    const access_token = getStoredAccessToken();
    if (!access_token) {
        throw new OptionsApiError(
            'accounts_fetch_failed',
            'No stored OAuth session found.',
            'createOtpConnection() requires a completed OAuth login (src/utils/auth/deriv-oauth.ts) before it can request an OTP.'
        );
    }

    const accounts = await listOptionsAccounts(access_token);
    const account = accounts.find(a => a.account_type === 'demo');
    if (!account) {
        throw new OptionsApiError(
            'no_demo_account',
            'No demo Options trading account exists yet for this session.',
            'This factory deliberately does not auto-create one - create a demo account explicitly (createOptionsAccount) first, then retry.'
        );
    }

    const websocket_url = await requestOptionsOtp(access_token, account.account_id);
    const api = generateOtpApiInstance(websocket_url);

    return { transport: 'otp', api, account };
};
