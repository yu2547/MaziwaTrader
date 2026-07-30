import { getAppId } from '@/components/shared';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce';

/**
 * Hand-rolled Authorization Code + PKCE flow against Deriv's documented OAuth
 * endpoints (developers.deriv.com/docs/intro/oauth), replacing
 * @deriv-com/auth-client's requestOidcAuthentication() for the "Start
 * Trading" / header login entry point. This intentionally skips the OIDC
 * discovery step (oauth.deriv.com/.well-known/openid-configuration) that the
 * previous implementation depended on and that was the confirmed root cause
 * of the earlier login failures - this module targets auth.deriv.com
 * directly with static endpoints, exactly as the documentation describes.
 *
 * Scope: the docs list trade / account_manage / application_read / payment
 * and show `trade+account_manage` as their own example - used here as a
 * starting point. Confirm this is actually the right combination for
 * MaziwaTrader's features before relying on it.
 *
 * Token exchange: the documentation says this POST should happen
 * server-side ("never perform the token exchange from the browser"), but
 * this project has no backend today, and @deriv-com/auth-client's own
 * reference implementation performs this same exchange from the browser.
 * Direct curl testing against the token endpoint (with a synthetic,
 * unregistered origin) showed no Access-Control-Allow-Origin header -
 * unlike the discovery/sessions endpoints, which do send one. Whether the
 * real, registered origin gets a CORS-enabled response is unverified and
 * needs a real login to confirm. If it's CORS-blocked in practice, only the
 * fetch() call in completeDerivLogin() below needs to move behind a backend
 * proxy - nothing else here is affected.
 *
 * Not implemented: bridging the resulting access_token into this app's
 * legacy multi-account token format (what @deriv-com/auth-client did
 * internally via an undocumented /oauth2/legacy/tokens call). This module
 * hands the caller a single access_token and lets it call api.authorize()
 * with that token directly, matching the single-account fallback path the
 * existing callback page already had. If that doesn't authorize
 * successfully, the legacy-token bridge is the next thing to investigate -
 * deliberately not guessing at an unverified endpoint here.
 */

const DERIV_OAUTH_HOST = 'https://auth.deriv.com';
const DERIV_OAUTH_SCOPE = 'trade account_manage';
const SESSION_KEY_CODE_VERIFIER = 'deriv_oauth_code_verifier';
const SESSION_KEY_STATE = 'deriv_oauth_state';

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

    window.location.assign(`${DERIV_OAUTH_HOST}/oauth2/auth?${params.toString()}`);
};

export type TDerivTokenResponse = {
    access_token: string;
    expires_in: number;
    token_type: string;
};

export class DerivOAuthStateMismatchError extends Error {
    constructor() {
        super('OAuth state parameter did not match the value stored before redirecting - possible CSRF, or a stale/reused callback URL.');
        this.name = 'DerivOAuthStateMismatchError';
    }
}

export const completeDerivLogin = async (params: { code: string | null; state: string | null }): Promise<TDerivTokenResponse> => {
    const stored_state = sessionStorage.getItem(SESSION_KEY_STATE);
    const stored_code_verifier = sessionStorage.getItem(SESSION_KEY_CODE_VERIFIER);

    // Single-use - clear immediately regardless of what happens next.
    sessionStorage.removeItem(SESSION_KEY_STATE);
    sessionStorage.removeItem(SESSION_KEY_CODE_VERIFIER);

    if (!params.state || !stored_state || params.state !== stored_state) {
        throw new DerivOAuthStateMismatchError();
    }
    if (!params.code) {
        throw new Error('No authorization code present in the callback URL.');
    }
    if (!stored_code_verifier) {
        throw new Error('No code_verifier found in sessionStorage - cannot complete the token exchange.');
    }

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: getAppId(),
        code: params.code,
        code_verifier: stored_code_verifier,
        redirect_uri: getRedirectUri(),
    });

    const response = await fetch(`${DERIV_OAUTH_HOST}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!response.ok) {
        const error_text = await response.text().catch(() => '');
        throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${error_text}`);
    }

    return response.json();
};
