# OAuth 2.0 PKCE Migration — Legacy Token Bridge Blocker

**Prepared by:** MaziwaTrader engineering
**App ID:** `33XnPHbQEAalZeY2dq33l`
**Package under test:** `@deriv-com/auth-client` v1.5.8 (latest published version at time of writing)
**Date:** 2026-07-31

## 1. Summary of our migration

MaziwaTrader is a DBot-style trading application built on Deriv's `bot-skeleton` architecture. Its WebSocket trading layer authenticates via `api.authorize(token)`, where `token` is a legacy per-account token (`acct1=...&token1=a1-...` format).

Our original login flow used `@deriv-com/auth-client`'s `requestOidcAuthentication()`. We found that this call always fetches OIDC discovery from a hardcoded host, `https://oauth.deriv.com/.well-known/openid-configuration`, which returns an HTTP 302 redirect to `https://deriv.com/` with no CORS headers under any request shape — meaning `requestOidcAuthentication()` can never complete from a browser, for any consumer of this SDK version, regardless of App ID or registered redirect URI.

Because no override for the discovery host exists anywhere in the SDK's public API, we migrated away from `requestOidcAuthentication()` and implemented Deriv's documented Authorization Code + PKCE flow directly, using the endpoints published at `developers.deriv.com/docs/intro/oauth/`:

- Authorization endpoint: `https://auth.deriv.com/oauth2/auth`
- Token endpoint: `https://auth.deriv.com/oauth2/token`

This flow is deployed to production and working end-to-end through to receiving a modern OAuth `access_token`. That is where the migration is currently blocked: our trading layer requires legacy per-account tokens, and the only bridge between the two token formats we can find is an SDK function that itself depends on the same broken host our original bug came from.

## 2. Evidence the application now performs OAuth PKCE correctly

Our hand-rolled flow (bypassing `@deriv-com/auth-client` entirely) performs:

1. Generates `code_verifier`, derives `code_challenge` via `BASE64URL(SHA256(code_verifier))`, and a random `state`; stores both in `sessionStorage`.
2. Redirects to:
    ```
    https://auth.deriv.com/oauth2/auth?response_type=code&client_id=33XnPHbQEAalZeY2dq33l
      &redirect_uri=https://www.maziwatrader.com/callback&scope=trade+account_manage
      &state=...&code_challenge=...&code_challenge_method=S256&brand=deriv
    ```
3. On return to `/callback`, validates `state` against the stored value (CSRF protection), then exchanges the authorization code:
    ```
    POST https://auth.deriv.com/oauth2/token
    Content-Type: application/x-www-form-urlencoded

    grant_type=authorization_code&client_id=...&code=...&code_verifier=...&redirect_uri=...
    ```

We verified every stage live, including instrumented log checkpoints firing in the correct order (`redirect initiated` → `callback received` → `state validated` → `token exchange started` → `token exchange completed` → `access token received`), and separately tested every non-authenticated path: OAuth error callbacks, missing/mismatched `state`, missing authorization code, and network failure — all handled with distinct, correct error states. We are able to receive a valid `access_token` from `https://auth.deriv.com/oauth2/token` via a real login. This confirms the token endpoint itself is live, correctly configured for our origin/App ID, and returns a usable OAuth 2.0 access token.

## 3. Evidence the application currently expects legacy account tokens

Tracing the trading layer's authorization call path from the code itself:

- The WebSocket authorizer (`authorizeAndSubscribe()`) calls `this.api.authorize(this.token)`, where `this.token = V2GetActiveToken()`.
- `V2GetActiveToken()` reads `localStorage.getItem('authToken')` as a raw string — no token-format validation, but the only writer of this key is:
- The app's auth bootstrap step, which populates `localStorage['authToken']` **only** from `loginInfo[0].token`, where `loginInfo` comes exclusively from Deriv's own `@deriv-com/utils` helper `URLUtils.getLoginInfoFromURL()` — a parser for legacy multi-account URL query parameters (`acct1=CR123&token1=a1-xxxxx&acct2=...&token2=...`).
- The active-account resolver, `V2GetActiveClientId()`, additionally requires `localStorage['accountsList']`, a `{loginid: token}` map populated only from that same legacy URL-param parsing.

There is no code path anywhere in the application that reads an OAuth `access_token` and hands it to `api.authorize()`. The trading layer is wired exclusively to the legacy multi-account token format.

## 4. Evidence the SDK still references `/oauth2/legacy/tokens`

`@deriv-com/auth-client` (npm, v1.5.8, our installed and the latest published version) ships an explicit, documented function for exactly this bridge:

```ts
// dist/oidc/oidc.d.ts
export type LegacyTokens = {
    acct1: string;
    acct2?: string;
    acct3?: string;
    token1: string;
    token2?: string;
    token3?: string;
    cur1: string;
    cur2?: string;
    cur3?: string;
};

/**
 * Fetches the tokens that will be passed to the `authorize` endpoint.
 * @param accessToken - The OAuth2/OIDC access token obtained from `requestOidcToken`
 * @returns Promise<LegacyTokens>
 */
export declare const requestLegacyToken: (accessToken: string) => Promise<LegacyTokens>;
```

Its runtime implementation (`dist/oidc/oidc.js`):

```js
const requestLegacyToken = async accessToken => {
    const { serverUrl } = getServerInfo(); // resolves to "oauth.deriv.com" for a plain .com host
    return await (
        await fetch(`https://${serverUrl}/oauth2/legacy/tokens`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
        })
    ).json();
};
```

It is also wired into the SDK's own `<Callback>` component (`dist/components/Callback/Callback.js`), which calls `requestOidcToken()` followed immediately by `requestLegacyToken()` before invoking the consumer's `onSignInSuccess(tokens, state)` callback — this is presented as the SDK's intended, first-class migration path for DBot-style consumers, not a deprecated or internal-only code path. It is undocumented on `developers.deriv.com`; the only documentation is the inline JSDoc and the package README.

The request is a bodyless `POST` carrying only `Authorization: Bearer <access_token>` — no request body, no `Content-Type` header.

## 5. Evidence the endpoint itself is unreachable

We tested both candidate hosts directly with `curl` (bypassing browser CORS entirely, so these results reflect server behavior, not a client-side restriction):

**`oauth.deriv.com` — the host the SDK's `getServerInfo()` resolves to for a `.com` domain:**

```
$ curl -i -X POST -H "Origin: https://www.maziwatrader.com" \
       -H "Authorization: Bearer <token>" \
       https://oauth.deriv.com/oauth2/legacy/tokens

HTTP/1.1 302 Found
Location: https://deriv.com/
Server: cloudflare
(no Access-Control-Allow-Origin header)
```

An `OPTIONS` preflight against the same URL returns an identical `302 → https://deriv.com/`, with no CORS headers. This is the same behavior we independently confirmed for `https://oauth.deriv.com/.well-known/openid-configuration` (the OIDC discovery endpoint that motivated our original migration away from `requestOidcAuthentication()`) — every path we have tested on `oauth.deriv.com` redirects unconditionally to the marketing site rather than serving a route.

**`auth.deriv.com` — the corrected host that _does_ serve OIDC discovery correctly:**

```
$ curl -i -X POST -H "Origin: https://www.maziwatrader.com" \
       -H "Authorization: Bearer <token>" \
       https://auth.deriv.com/oauth2/legacy/tokens

HTTP/1.1 404 Not Found
access-control-allow-origin: https://www.maziwatrader.com
access-control-allow-credentials: true
ory-network-ingress: T
ory-network-region: euw
Server: cloudflare

{"...": "404 - Route not found"}
```

This is a clean, correctly-CORS-configured 404 from live Ory-network infrastructure — not a redirect and not a CORS block. `auth.deriv.com` is reachable, correctly configured for our origin, and simply does not have this route.

**Conclusion:** from our vantage point, `/oauth2/legacy/tokens` is not served by either host our client-side code can resolve to. `oauth.deriv.com` redirects instead of routing; `auth.deriv.com` is live but returns a genuine 404 for this path.

## 6. Why this blocks migration of existing DBot-style applications

Our trading layer — like, we expect, other DBot-based Deriv applications — was built against the legacy multi-account token model (`acct1`/`token1`/...), because that has historically been the only token format the WebSocket `authorize` API accepts. The public OAuth 2.0 + PKCE flow Deriv documents at `developers.deriv.com/docs/intro/oauth/` produces a different, incompatible token type (an opaque OAuth `access_token`), with no documented public conversion path.

`@deriv-com/auth-client`'s `requestLegacyToken()` is the only bridge we can find between these two token formats, and it is broken at the transport level — not merely undocumented. This means:

- We cannot complete migration to the documented OAuth flow while preserving existing trading functionality, because there is no working way to obtain a token our `api.authorize()` call will accept once a user has gone through OAuth login.
- Any other DBot fork or consumer application built on the same architecture (legacy-token WebSocket authorization) will hit the identical wall the moment it tries to adopt the documented public OAuth flow.
- We have deliberately **not** implemented any workaround (no scraping, no unofficial endpoints, no reverse-engineered alternative host) while this is unresolved, since doing so would be fragile and unsupported.

## 7. Questions for Deriv

1. Is `/oauth2/legacy/tokens` still a supported endpoint?
2. If yes — what is the correct host to call it on? (Neither `oauth.deriv.com` nor `auth.deriv.com` appears to serve it, per the evidence in Section 5.)
3. If no — what is the supported migration path for existing DBot-style applications whose WebSocket `authorize` call currently requires legacy per-account tokens?
4. How should applications obtain per-account legacy tokens after completing the documented Authorization Code + PKCE flow, if `requestLegacyToken()` is not the intended mechanism?
5. Should DBot forks migrate entirely away from `api.authorize(legacy_token)` and onto the Trading REST API / OTP workflow instead? If so, is there documentation for that path specifically for existing WebSocket-based trading applications, as opposed to net-new integrations?

We're happy to provide additional logs, HAR captures, or a live reproduction if useful.
