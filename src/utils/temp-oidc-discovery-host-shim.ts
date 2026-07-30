/**
 * TEMPORARY COMPATIBILITY SHIM.
 *
 * Remove this whole file, and its one activation call in src/main.tsx, in a
 * single commit once @deriv-com/auth-client ships a version that targets the
 * correct OIDC discovery host - or Deriv confirms oauth.deriv.com is the
 * intended one after all.
 *
 * Root cause (confirmed via live HTTP capture, not assumption):
 * requestOidcAuthentication() always fetches
 *   https://oauth.deriv.com/.well-known/openid-configuration
 * to discover the authorize/token endpoints. That host is hardcoded inside
 * the library - node_modules/@deriv-com/auth-client/dist/constants/urls.js,
 * getServerInfo() - with no exposed parameter, exported setter, or env var to
 * override it (checked the library's full public export list; nothing takes
 * a server/authority override).
 *
 * That endpoint currently returns HTTP 302 -> https://deriv.com/ with no
 * Access-Control-Allow-Origin header under any request shape (verified with
 * curl: with an Origin header, without one, and via an OPTIONS preflight -
 * identical redirect every time). A redirect response with no CORS header can
 * never satisfy a browser fetch() from any origin, so OAuth never starts.
 *
 * https://auth.deriv.com/.well-known/openid-configuration, by contrast,
 * returns a real discovery document with a proper
 * access-control-allow-origin header (verified live) - matching what Deriv
 * Support said to use and what developers.deriv.com/docs/intro/oauth
 * documents.
 *
 * This shim intercepts *only* that one exact discovery URL and rewrites it to
 * the auth.deriv.com equivalent - every other fetch in the app (including
 * this project's own WebSocket connections, which don't go through fetch()
 * at all) passes through the original, unwrapped fetch untouched. Every
 * endpoint the library uses afterwards (authorize, token) is read from that
 * document's own contents, not re-hardcoded here, so the rest of the OIDC
 * flow follows the corrected host automatically.
 */

declare global {
    interface Window {
        __oidc_discovery_shim_installed__?: boolean;
    }
}

const BROKEN_DISCOVERY_URL = 'https://oauth.deriv.com/.well-known/openid-configuration';
const CORRECTED_DISCOVERY_URL = 'https://auth.deriv.com/.well-known/openid-configuration';

export const installOidcDiscoveryHostShim = () => {
    if (typeof window === 'undefined' || window.__oidc_discovery_shim_installed__) return;
    window.__oidc_discovery_shim_installed__ = true;

    const original_fetch = window.fetch.bind(window);

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

        if (url !== BROKEN_DISCOVERY_URL) {
            return original_fetch(input, init);
        }

        const corrected_input =
            input instanceof Request ? new Request(CORRECTED_DISCOVERY_URL, input) : CORRECTED_DISCOVERY_URL;
        return original_fetch(corrected_input, init);
    };
};
