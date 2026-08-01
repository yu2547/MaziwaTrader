import { getAppId } from '@/components/shared';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce';

/**
 * Authorization Code + PKCE flow against Deriv's documented OAuth endpoints
 * (developers.deriv.com/docs/intro/oauth), replacing
 * @deriv-com/auth-client's requestOidcAuthentication() for the "Start
 * Trading" / header login entry point.
 *
 * This deliberately stops once an access_token has been obtained. Handing
 * that token to the app's WebSocket authorize() call is a separate,
 * unapproved decision - see the migration report.
 */

const DERIV_OAUTH_HOST = 'https://auth.deriv.com';
// 'account_manage' is not granted to this App ID (confirmed live: Deriv's
// authorization server rejects the whole request with invalid_scope when
// it's requested, and accepts it when only 'trade' is requested). Until the
// App ID's registration is updated on Deriv's developer portal, requesting
// only 'trade' keeps login working; some Options API endpoints that need
// account_manage (e.g. creating a brand-new Options account) won't be
// usable until then.
const DERIV_OAUTH_SCOPE = 'trade';

const SESSION_KEY_CODE_VERIFIER = 'deriv_oauth_code_verifier';
const SESSION_KEY_STATE = 'deriv_oauth_state';
const SESSION_KEY_ACCESS_TOKEN = 'deriv_oauth_access_token';
const SESSION_KEY_TOKEN_META = 'deriv_oauth_token_meta';

const log = (stage: string, detail?: unknown) => {
    // eslint-disable-next-line no-console
    if (detail === undefined) console.info(`[MW-AUTH] ${stage}`);
    // eslint-disable-next-line no-console
    else console.info(`[MW-AUTH] ${stage}`, detail);
};

const logError = (stage: string, detail?: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`[MW-AUTH] ${stage}`, detail);
};

/** Discriminator so the UI can show a specific message per failure mode. */
export type TDerivOAuthErrorKind =
    | 'oauth_server_error'
    | 'redirect_uri_mismatch'
    | 'invalid_state'
    | 'missing_code'
    | 'missing_verifier'
    | 'network_failure'
    | 'token_exchange_failed';

export class DerivOAuthError extends Error {
    kind: TDerivOAuthErrorKind;
    detail?: string;

    constructor(kind: TDerivOAuthErrorKind, message: string, detail?: string) {
        super(message);
        this.name = 'DerivOAuthError';
        this.kind = kind;
        this.detail = detail;
    }
}

const getRedirectUri = () => `${window.location.origin}/callback`;

export const beginDerivLogin = async (): Promise<void> => {
    const code_verifier = generateCodeVerifier();
    const code_challenge = await generateCodeChallenge(code_verifier);
    const state = generateState();

    sessionStorage.setItem(SESSION_KEY_CODE_VERIFIER, code_verifier);
    sessionStorage.setItem(SESSION_KEY_STATE, state);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: getAppId(),
        redirect_uri: getRedirectUri(),
        scope: DERIV_OAUTH_SCOPE,
        state,
        code_challenge,
        code_challenge_method: 'S256',
        brand: 'deriv',
    });

    const url = `${DERIV_OAUTH_HOST}/oauth2/auth?${params.toString()}`;
    log('redirect initiated', { client_id: getAppId(), redirect_uri: getRedirectUri(), scope: DERIV_OAUTH_SCOPE });
    window.location.assign(url);
};

export type TDerivTokenResponse = {
    access_token: string;
    expires_in: number;
    token_type: string;
};

export type TCallbackParams = {
    code: string | null;
    state: string | null;
    error: string | null;
    error_description: string | null;
};

/** Reads the four OAuth callback query parameters the documentation defines. */
export const readCallbackParams = (search: string = window.location.search): TCallbackParams => {
    const q = new URLSearchParams(search);
    const params = {
        code: q.get('code'),
        state: q.get('state'),
        error: q.get('error'),
        error_description: q.get('error_description'),
    };
    log('callback received', {
        has_code: !!params.code,
        has_state: !!params.state,
        error: params.error,
        error_description: params.error_description,
    });
    return params;
};

export const getStoredAccessToken = () => sessionStorage.getItem(SESSION_KEY_ACCESS_TOKEN);

export const getStoredTokenMeta = (): { expires_in: number; token_type: string; obtained_at: number } | null => {
    const raw = sessionStorage.getItem(SESSION_KEY_TOKEN_META);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

/** Removes the persisted OAuth session - call this on logout so a stale token can't be silently restored on the next load. */
export const clearStoredSession = () => {
    sessionStorage.removeItem(SESSION_KEY_ACCESS_TOKEN);
    sessionStorage.removeItem(SESSION_KEY_TOKEN_META);
};

/**
 * Reads back the access token completeDerivLogin() persisted to sessionStorage,
 * so a page refresh doesn't lose the session (oauth_session itself is
 * in-memory only and is rebuilt empty on every load). Returns the remaining
 * lifetime rather than the original expires_in, and clears + returns null for
 * a token that's already expired, so callers never restore a dead session.
 */
export const restoreStoredSession = (): { access_token: string; expires_in: number } | null => {
    const access_token = getStoredAccessToken();
    const meta = getStoredTokenMeta();
    if (!access_token || !meta) return null;

    const elapsed_seconds = (Date.now() - meta.obtained_at) / 1000;
    const remaining_seconds = Math.floor(meta.expires_in - elapsed_seconds);
    if (remaining_seconds <= 0) {
        log('stored session expired, clearing', { obtained_at: meta.obtained_at, expires_in: meta.expires_in });
        clearStoredSession();
        return null;
    }

    log('stored session restored', { remaining_seconds });
    return { access_token, expires_in: remaining_seconds };
};

export const completeDerivLogin = async (params: TCallbackParams): Promise<TDerivTokenResponse> => {
    // The OAuth server rejected or the user cancelled - surface its own reason
    // rather than attempting an exchange that cannot succeed.
    if (params.error) {
        const description = params.error_description || params.error;
        const is_redirect_mismatch = /redirect|uri/i.test(description) || params.error === 'invalid_request';
        logError('oauth server returned an error', {
            error: params.error,
            error_description: params.error_description,
        });
        throw new DerivOAuthError(
            is_redirect_mismatch ? 'redirect_uri_mismatch' : 'oauth_server_error',
            description,
            `error=${params.error}`
        );
    }

    const stored_state = sessionStorage.getItem(SESSION_KEY_STATE);
    const stored_code_verifier = sessionStorage.getItem(SESSION_KEY_CODE_VERIFIER);

    // Single-use: clear before any early return so a failed attempt can never
    // be replayed with the same verifier/state pair.
    sessionStorage.removeItem(SESSION_KEY_STATE);
    sessionStorage.removeItem(SESSION_KEY_CODE_VERIFIER);

    if (!params.state || !stored_state || params.state !== stored_state) {
        logError('state validation failed', { returned: params.state, had_stored_state: !!stored_state });
        throw new DerivOAuthError(
            'invalid_state',
            'The security check on the sign-in response failed.',
            'The `state` value returned by Deriv did not match the one stored before redirecting. This can happen if the callback URL was reopened, bookmarked, or reloaded.'
        );
    }
    log('state validated');

    if (!params.code) {
        throw new DerivOAuthError('missing_code', 'Deriv did not return an authorization code.');
    }
    if (!stored_code_verifier) {
        throw new DerivOAuthError(
            'missing_verifier',
            'The sign-in could not be completed in this browser tab.',
            'No PKCE code_verifier was found in sessionStorage. It is cleared when the tab closes, so sign-in must finish in the tab it started in.'
        );
    }

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: getAppId(),
        code: params.code,
        code_verifier: stored_code_verifier,
        redirect_uri: getRedirectUri(),
    });

    log('token exchange started', { endpoint: `${DERIV_OAUTH_HOST}/oauth2/token`, redirect_uri: getRedirectUri() });

    let response: Response;
    try {
        response = await fetch(`${DERIV_OAUTH_HOST}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
    } catch (network_error) {
        // fetch() only rejects for network-level failures - DNS, offline, or a
        // CORS policy that blocks the response from being read at all.
        logError('token exchange network failure', network_error);
        throw new DerivOAuthError(
            'network_failure',
            'Could not reach Deriv to complete sign-in.',
            'The request to the token endpoint failed before any response was received. This is usually a network problem or a CORS restriction on the token endpoint, which would mean the exchange has to happen server-side.'
        );
    }

    log('token exchange completed', { status: response.status });

    if (!response.ok) {
        const raw = await response.text().catch(() => '');
        logError('token exchange rejected', { status: response.status, body: raw });
        throw new DerivOAuthError(
            'token_exchange_failed',
            `Deriv rejected the sign-in (HTTP ${response.status}).`,
            raw || response.statusText
        );
    }

    const token_response: TDerivTokenResponse = await response.json();

    sessionStorage.setItem(SESSION_KEY_ACCESS_TOKEN, token_response.access_token);
    sessionStorage.setItem(
        SESSION_KEY_TOKEN_META,
        JSON.stringify({
            expires_in: token_response.expires_in,
            token_type: token_response.token_type,
            obtained_at: Date.now(),
        })
    );

    log('access token received', {
        prefix: `${token_response.access_token.slice(0, 12)}…`,
        length: token_response.access_token.length,
        token_type: token_response.token_type,
        expires_in: token_response.expires_in,
    });

    return token_response;
};
