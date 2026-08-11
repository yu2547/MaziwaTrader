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

## 8. Follow-up investigation: the Options OTP WebSocket as an alternative path

**Date added:** 2026-08-04

Given Section 6's conclusion that the classic legacy-token bridge is unreachable, we investigated whether Deriv's newer OTP-authenticated Options WebSocket (`GET /trading/v1/options/ws/demo`, `GET /trading/v1/options/ws/real`) could serve as an alternative live-trading transport — one that doesn't depend on the broken `/oauth2/legacy/tokens` bridge at all, since it authenticates per-connection via an OTP rather than a legacy token.

This channel is reached entirely through the modern OAuth `access_token` this app already obtains successfully (Section 2): `POST /trading/v1/options/accounts/{accountId}/otp` with `Authorization: Bearer <access_token>` returns a ready-to-use WebSocket URL with a short-lived (120s), single-use OTP embedded as a query parameter.

### 8.1 Evidence this channel speaks the same message envelope as the classic API

We connected to `wss://api.derivws.com/trading/v1/options/ws/demo?otp=...` against a real demo Options account and sent a single, read-only, classic-format message:

```
SEND: {"balance":1,"req_id":1}
```

The response:

```json
{
    "balance": { "...": "..." },
    "echo_req": { "balance": 1, "req_id": 1 },
    "msg_type": "balance",
    "req_id": 1
}
```

This is the exact classic-API response envelope (`msg_type`, `echo_req`, matching `req_id`) — not a different shape. No `authorize` message was sent at any point; the connection is already scoped to the correct account purely via the OTP in the URL.

### 8.2 Evidence the trading-message schema (`proposal`/`buy`/`sell`) is entirely undocumented

We then sent a classic-format price-quote request (`proposal` — read-only; it does not create a contract or move funds) over the same connection:

```
SEND: {"proposal":1,"req_id":2,"amount":10,"basis":"stake","contract_type":"CALL","currency":"USD","duration":5,"duration_unit":"t","symbol":"R_100"}
```

The response:

```json
{
    "echo_req": { "...": "..." },
    "error": {
        "code": "InputValidationFailed",
        "details": {},
        "message": "Input validation failed: Properties not allowed: symbol."
    },
    "msg_type": "proposal",
    "req_id": 2
}
```

The envelope shape is still classic-compatible (`msg_type: "proposal"`, `echo_req`, matching `req_id`), but the request schema itself has diverged: `symbol` — the field the classic API and every other Deriv trading surface uses to identify the underlying market — is explicitly rejected. `error.details` was empty, so the error message is the only clue available, and it does not say what field replaces `symbol`.

We searched for a documented alternative through two independent channels and found neither:

1. **`developers.deriv.com/docs/options/ws-demo/` and `ws-real/`** — the "Request Schema" tab on both pages displays "Failed to load schema" in the UI, and the linked raw schema file (`/schemas/ws_demo_request.schema.json`) returns nothing renderable. These pages document only the WebSocket _upgrade handshake_ (the `otp` query parameter, HTTP status codes 101/400/401) — nothing about in-connection message types.
2. **The published OpenAPI spec** (`developers.deriv.com/data/production-openapi.json`, referenced by this project's own code comments as the source previously used to confirm schemas) — contains 38 schema definitions, none of which relate to proposals, contracts, or trading instructions (`AppMarkupBreakdownRow`, `LegacyAccountItem`, `Wallet`, `PaymentAgentDetail`, etc.). The spec entries for `/trading/v1/options/ws/demo` and `/trading/v1/options/ws/real` document only the same handshake parameters as the docs pages.

**Conclusion:** the request/response schema for trading instructions (`proposal`, and by strong implication `buy`/`sell`) on the OTP-authenticated Options WebSocket is not published anywhere we can find — not on the documentation site, not in the OpenAPI spec, and not surfaced by the API's own validation error. This is a distinct gap from Section 5's token-bridge issue: the transport and authentication work correctly here; it is specifically the trading-message contract that has no public reference.

### 8.3 Additional questions for Deriv

6. What is the correct request schema for `proposal` on the OTP-authenticated Options WebSocket (`/trading/v1/options/ws/demo` and `/ws/real`)? Specifically, what field replaces `symbol` for identifying the underlying market/instrument?
7. Is there a documented request/response schema anywhere for `buy`, `sell`, `proposal_open_contract`, `transaction`, or other trading-instruction message types on this same channel?
8. Is there a way to introspect available instruments/contract types on this API surface (an equivalent to the classic API's `contracts_for`), so integrators could self-discover the correct terminology rather than trial-and-error against a live account?
9. Given this channel's documented scope is narrower than the classic API ("Options/Multipliers/Accumulators/Derived Indices only" per developer messaging elsewhere) — is it intended as a full replacement for DBot-style multi-asset trading, or a separate, purpose-specific product?

### 8.4 Resolution: `underlying_symbol`, and `contracts_for` without `currency`

Rather than wait on a reply, we self-answered question 6 with one more read-only round, using the API's own discovery messages against it:

1. `active_symbols` (already shown envelope-compatible in 8.1) returns real data whose entries are labeled `underlying_symbol`, not `symbol` (e.g. `"underlying_symbol": "1HZ100V"`).
2. Retrying `contracts_for` **without** a `currency` field (the field Section 8.2 showed this endpoint rejects) succeeded (`error: null`), returning real contract definitions, each also keyed by `underlying_symbol`.
3. Retrying `proposal` with `underlying_symbol` in place of `symbol` succeeded (`error: null`), returning a complete, real price quote:

```json
{
    "proposal": {
        "ask_price": 10,
        "payout": 18.18,
        "spot": 842.28,
        "id": "a4a4a2a6-5a9c-f628-6409-5f9fd4aa620e",
        "longcode": "Win payout if Volatility 100 (1s) Index after 5 ticks is strictly higher than entry spot.",
        "validation_params": { "payout": { "max": "10000.00" }, "stake": { "min": "0.35" } }
    },
    "msg_type": "proposal",
    "req_id": 2
}
```

**This answers questions 6 and 8 above without needing a reply from Deriv.** The corrected, confirmed picture: the message envelope and message _types_ are classic-compatible, matching what Deriv support told us — but individual message _schemas_ have small, real field differences from the classic API, not zero changes. Concretely, so far:

| Message         | Classic field      | This API's field    |
| --------------- | ------------------ | ------------------- |
| `proposal`      | `symbol`           | `underlying_symbol` |
| `contracts_for` | accepts `currency` | rejects `currency`  |

Questions 7 (`buy`/`sell` schema) and 9 (product scope) remain open. `buy` and `sell` have deliberately not been sent, even against a demo account, without explicit approval — unlike `proposal`/`contracts_for`/`active_symbols`/`balance`, they create a contract / consume demo funds rather than only reading state.

We're happy to provide additional logs, HAR captures, or a live reproduction if useful.
