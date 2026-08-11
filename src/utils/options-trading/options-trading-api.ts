import { getAppId } from '@/components/shared';
import { getStoredAccessToken } from '@/utils/auth/deriv-oauth';

/**
 * Deriv's documented "Options Setup" REST API + OTP-authenticated WebSocket
 * (developers.deriv.com/docs/options/, schemas confirmed against
 * developers.deriv.com/data/production-openapi.json).
 *
 * This is a standalone trading channel that runs ALONGSIDE the existing
 * legacy-token WebSocket (websockets/v3) bot-skeleton's trade engine depends
 * on - it does not replace it. The endpoints here operate on a distinct
 * account/product surface ("Options trading accounts", under
 * /trading/v1/options/*), authenticated with the OAuth access_token obtained
 * via src/utils/auth/deriv-oauth.ts. Nothing here touches legacy tokens,
 * AuthWrapper, or api-base.ts.
 */

const OPTIONS_API_HOST = 'https://api.derivws.com';

const log = (stage: string, detail?: unknown) => {
    // eslint-disable-next-line no-console
    if (detail === undefined) console.info(`[MW-OPTIONS] ${stage}`);
    // eslint-disable-next-line no-console
    else console.info(`[MW-OPTIONS] ${stage}`, detail);
};

const logError = (stage: string, detail?: unknown) => {
    // eslint-disable-next-line no-console
    console.error(`[MW-OPTIONS] ${stage}`, detail);
};

export type TOptionsApiErrorKind =
    | 'accounts_fetch_failed'
    | 'account_create_failed'
    | 'otp_request_failed'
    | 'websocket_connect_failed'
    | 'network_failure'
    | 'invalid_response'
    | 'no_demo_account';

export class OptionsApiError extends Error {
    kind: TOptionsApiErrorKind;
    detail?: string;

    constructor(kind: TOptionsApiErrorKind, message: string, detail?: string) {
        super(message);
        this.name = 'OptionsApiError';
        this.kind = kind;
        this.detail = detail;
    }
}

// Matches components.schemas.OptionsAccount in the OpenAPI spec.
export type TOptionsAccount = {
    account_id: string;
    balance: number;
    currency: string;
    group: string;
    status: 'active' | 'inactive';
    account_type: 'demo' | 'real';
};

type TApiErrorEntry = {
    status: number;
    code: string;
    message: string;
    field?: string;
};

type TApiErrorEnvelope = { errors: TApiErrorEntry[] };

const buildHeaders = (access_token: string, has_body: boolean): Record<string, string> => ({
    'Deriv-App-ID': getAppId(),
    Authorization: `Bearer ${access_token}`,
    ...(has_body ? { 'Content-Type': 'application/json' } : {}),
});

const extractErrorMessage = (raw: string): string => {
    try {
        const parsed = JSON.parse(raw) as TApiErrorEnvelope;
        return parsed.errors?.[0]?.message || raw;
    } catch {
        return raw;
    }
};

/** GET /trading/v1/options/accounts - lists every Options trading account (demo + real) the user owns. */
export const listOptionsAccounts = async (access_token: string): Promise<TOptionsAccount[]> => {
    log('list accounts started');
    let response: Response;
    try {
        response = await fetch(`${OPTIONS_API_HOST}/trading/v1/options/accounts`, {
            method: 'GET',
            headers: buildHeaders(access_token, false),
        });
    } catch (network_error) {
        logError('list accounts network failure', network_error);
        throw new OptionsApiError(
            'network_failure',
            'Could not reach the Options Trading API.',
            network_error instanceof Error ? network_error.message : String(network_error)
        );
    }

    const raw = await response.text();
    if (!response.ok) {
        logError('list accounts rejected', { status: response.status, body: raw });
        throw new OptionsApiError(
            'accounts_fetch_failed',
            `Failed to list Options accounts (HTTP ${response.status}).`,
            extractErrorMessage(raw)
        );
    }

    try {
        const parsed = JSON.parse(raw) as { data: TOptionsAccount[] };
        log('list accounts completed', { count: parsed.data?.length ?? 0 });
        return parsed.data ?? [];
    } catch {
        logError('list accounts invalid response', raw);
        throw new OptionsApiError('invalid_response', 'Options API returned an unreadable response.', raw);
    }
};

export type TCreateOptionsAccountParams = {
    currency: string;
    group: string;
    account_type: 'demo' | 'real';
};

/** POST /trading/v1/options/accounts - creates a new Options trading account. */
export const createOptionsAccount = async (
    access_token: string,
    params: TCreateOptionsAccountParams
): Promise<TOptionsAccount> => {
    log('create account started', params);
    let response: Response;
    try {
        response = await fetch(`${OPTIONS_API_HOST}/trading/v1/options/accounts`, {
            method: 'POST',
            headers: buildHeaders(access_token, true),
            body: JSON.stringify(params),
        });
    } catch (network_error) {
        logError('create account network failure', network_error);
        throw new OptionsApiError(
            'network_failure',
            'Could not reach the Options Trading API.',
            network_error instanceof Error ? network_error.message : String(network_error)
        );
    }

    const raw = await response.text();
    if (!response.ok) {
        logError('create account rejected', { status: response.status, body: raw });
        throw new OptionsApiError(
            'account_create_failed',
            `Failed to create an Options account (HTTP ${response.status}).`,
            extractErrorMessage(raw)
        );
    }

    try {
        const parsed = JSON.parse(raw) as { data: TOptionsAccount[] };
        const account = parsed.data?.[0];
        if (!account) throw new Error('response contained no account');
        log('create account completed', { account_id: account.account_id });
        return account;
    } catch {
        logError('create account invalid response', raw);
        throw new OptionsApiError('invalid_response', 'Options API returned an unreadable response.', raw);
    }
};

/**
 * POST /trading/v1/options/accounts/{accountId}/otp - issues a single-use,
 * 120-second OTP and returns a ready-to-use WebSocket URL with the OTP
 * already attached as a query parameter. Connect immediately after calling
 * this; the OTP cannot be reused or retrieved again.
 */
export const requestOptionsOtp = async (access_token: string, account_id: string): Promise<string> => {
    log('otp request started', { account_id });
    let response: Response;
    try {
        response = await fetch(
            `${OPTIONS_API_HOST}/trading/v1/options/accounts/${encodeURIComponent(account_id)}/otp`,
            {
                method: 'POST',
                headers: buildHeaders(access_token, false),
            }
        );
    } catch (network_error) {
        logError('otp request network failure', network_error);
        throw new OptionsApiError(
            'network_failure',
            'Could not reach the Options Trading API.',
            network_error instanceof Error ? network_error.message : String(network_error)
        );
    }

    const raw = await response.text();
    if (!response.ok) {
        logError('otp request rejected', { status: response.status, body: raw });
        throw new OptionsApiError(
            'otp_request_failed',
            `Failed to obtain an OTP (HTTP ${response.status}).`,
            extractErrorMessage(raw)
        );
    }

    try {
        const parsed = JSON.parse(raw) as { data: { url: string } };
        if (!parsed.data?.url) throw new Error('response contained no url');
        log('otp request completed');
        return parsed.data.url;
    } catch {
        logError('otp request invalid response', raw);
        throw new OptionsApiError('invalid_response', 'Options API returned an unreadable response.', raw);
    }
};

/**
 * Opens the OTP-authenticated Options WebSocket (ws/demo or ws/real,
 * whichever host the OTP response URL points to). Resolves once the
 * connection is open, rejects if it errors or closes before opening.
 */
export const connectOptionsWebSocket = (websocket_url: string): Promise<WebSocket> => {
    log('websocket connect started');
    return new Promise((resolve, reject) => {
        let settled = false;
        const socket = new WebSocket(websocket_url);

        socket.onopen = () => {
            if (settled) return;
            settled = true;
            log('websocket connect completed');
            resolve(socket);
        };
        socket.onerror = () => {
            if (settled) return;
            settled = true;
            logError('websocket connect failed');
            reject(new OptionsApiError('websocket_connect_failed', 'Could not open the Options WebSocket connection.'));
        };
        socket.onclose = event => {
            if (settled) return;
            settled = true;
            logError('websocket closed before opening', { code: event.code, reason: event.reason });
            reject(
                new OptionsApiError(
                    'websocket_connect_failed',
                    'The Options WebSocket closed before it finished connecting.',
                    `code=${event.code}${event.reason ? ` reason=${event.reason}` : ''}`
                )
            );
        };
    });
};

export type TOptionsChannelResult = {
    account: TOptionsAccount;
    was_created: boolean;
    websocket: WebSocket;
};

/**
 * End-to-end verification helper: list accounts, create a demo Options
 * account if none exist yet, request an OTP for it, and open the
 * OTP-authenticated WebSocket. Uses a demo account so this can be run safely
 * without risking real funds. Does not send any trading messages over the
 * socket - opening it is the full extent of what this proves.
 */
export const establishOptionsTradingChannel = async (access_token: string): Promise<TOptionsChannelResult> => {
    const accounts = await listOptionsAccounts(access_token);
    let account = accounts.find(a => a.account_type === 'demo');
    let was_created = false;

    if (!account) {
        account = await createOptionsAccount(access_token, { currency: 'USD', group: 'row', account_type: 'demo' });
        was_created = true;
    }

    const websocket_url = await requestOptionsOtp(access_token, account.account_id);
    const websocket = await connectOptionsWebSocket(websocket_url);

    return { account, was_created, websocket };
};

/**
 * DIAGNOSTIC ONLY - not called from anywhere in the app, not wired to any
 * button or page. Confirms or refutes a specific hypothesis before any real
 * trading logic gets built: does this OTP-authenticated Options WebSocket
 * speak the same classic-API message protocol (`{balance:1,...}`,
 * `{proposal:1,...}`, and by extension `buy`/`sell`) that
 * public-market-feed.ts already confirmed live for the *public* Options
 * WebSocket? Deriv's own docs for this endpoint are currently broken
 * ("Failed to load schema" on every /docs/options/ws-* page, and the linked
 * raw schema JSON 404s), so this sends only read-only, well-known classic
 * messages and returns exactly what comes back - no assumption, no trade
 * risk.
 *
 * `proposal`, `contracts_for`, and `active_symbols` are all reads/quotes,
 * not commitments - none creates a contract or moves any funds, which is
 * why they're all safe to include here alongside `balance`. `buy`/`sell`
 * are deliberately NOT sent by this probe - those do commit funds/create a
 * contract, so their compatibility stays inferred from the shared envelope
 * shape until a human explicitly approves testing them.
 *
 * Safety properties, by construction:
 * - Reads the access_token itself from sessionStorage (the same key
 *   deriv-oauth.ts already stores it under after a real login) - the token
 *   never has to be copied, pasted, or printed anywhere to run this.
 * - Only ever requests the DEMO Options account (finds one, or creates one
 *   via the documented create-account endpoint; never touches a real-money
 *   account).
 * - Sends only `balance`, `contracts_for`, `active_symbols`, and `proposal`
 *   - all read-only quotes/reads, never `buy`, `sell`, or anything else
 *   that mutates account state.
 * - Closes the socket the instant every response has arrived (or on
 *   error/timeout) - never stays open, never becomes a standing connection.
 *
 * Logs each layer separately (STEP 1 token, STEP 2 REST accounts call,
 * STEP 3 OTP call, STEP 4 WebSocket open, STEP 5/7/9/11 send, STEP 6/8/10/12
 * receive, STEP 13 close) so a failure is localized to a specific layer
 * instead of only ever showing a final success/failure. Each receive also
 * prints `msg_type` and `error` on their own line first, ahead of the full
 * body, so a scan of the console output doesn't require expanding every
 * object to see whether that step succeeded.
 *
 * Run from the browser console after logging in for real:
 *   import('/src/utils/options-trading/options-trading-api.ts').then(m => m.probeProtocolCompatibility())
 */
export const probeProtocolCompatibility = async (): Promise<Record<string, unknown>[]> => {
    log('STEP 1: checking for a stored OAuth token');
    const access_token = getStoredAccessToken();
    if (!access_token) {
        logError('STEP 1 failed: no stored OAuth session - log in for real first, then run this from the console.');
        throw new OptionsApiError('accounts_fetch_failed', 'No stored OAuth session found.');
    }
    log('STEP 1: OAuth token found');

    log('STEP 2: GET /trading/v1/options/accounts');
    const accounts = await listOptionsAccounts(access_token);
    log('STEP 2: accounts received', accounts);
    let account = accounts.find(a => a.account_type === 'demo');

    if (!account) {
        log('STEP 2: no demo account yet, creating one');
        account = await createOptionsAccount(access_token, { currency: 'USD', group: 'row', account_type: 'demo' });
        log('STEP 2: demo account created', account);
    }

    log('STEP 3: POST .../otp', { account_id: account.account_id });
    const websocket_url = await requestOptionsOtp(access_token, account.account_id);
    log('STEP 3: OTP url received');

    log('STEP 4: opening WebSocket');
    const websocket = await connectOptionsWebSocket(websocket_url);
    log('STEP 4: WebSocket opened');

    // Four read-only messages, ordered to answer one question at a time
    // before attempting the one that already failed:
    //   can I talk to the socket? (balance)
    //   -> can it describe contracts for a given market? (contracts_for -
    //      this is the classic API's own answer to "what identifier does a
    //      proposal need", so it's the most directly relevant discovery call
    //      to the `symbol` rejection, not a generic fallback)
    //   -> can it describe markets in general? (active_symbols)
    //   -> can I request a proposal? (proposal - already known to fail with
    //      `symbol`; kept in the sequence so its result sits alongside
    //      whatever the discovery calls reveal, in one run)
    // None of the four creates a contract or moves funds.
    //
    // Both `contracts_for` and `proposal` are already known (from a prior
    // run) to reject part of the classic request shape - `currency` on
    // contracts_for, `symbol` on proposal. This round tests the corrected
    // fields, derived from what active_symbols itself reported back rather
    // than guessed: it labels every instrument with `underlying_symbol`,
    // and "1HZ100V" is a value it confirmed is real and currently open.
    const requests: Array<{ label: string; body: Record<string, unknown> }> = [
        { label: 'balance', body: { balance: 1, req_id: 1 } },
        { label: 'contracts_for', body: { contracts_for: 'R_100', req_id: 2 } },
        { label: 'active_symbols', body: { active_symbols: 'brief', req_id: 3 } },
        {
            label: 'proposal',
            body: {
                proposal: 1,
                req_id: 4,
                amount: 10,
                basis: 'stake',
                contract_type: 'CALL',
                currency: account.currency,
                duration: 5,
                duration_unit: 't',
                underlying_symbol: '1HZ100V',
            },
        },
    ];

    const responses: Record<string, unknown>[] = [];
    let step = 5;

    return new Promise((resolve, reject) => {
        const sendNext = () => {
            const next = requests[responses.length];
            if (!next) {
                websocket.close(1000, 'probe complete');
                return;
            }
            log(`STEP ${step}: SEND (${next.label})`, next.body);
            step += 1;
            websocket.send(JSON.stringify(next.body));
        };

        const timeout = setTimeout(() => {
            websocket.close();
            reject(new OptionsApiError('network_failure', 'No response to the protocol probe within 10s.'));
        }, 10000);

        websocket.onmessage = event => {
            log(`STEP ${step}: RECEIVE`);
            step += 1;
            let parsed: Record<string, unknown>;
            try {
                parsed = JSON.parse(event.data);
            } catch {
                clearTimeout(timeout);
                logError('probe: response was not valid JSON', event.data);
                websocket.close();
                reject(new OptionsApiError('invalid_response', 'Probe response was not valid JSON.', event.data));
                return;
            }
            log('msg_type:', parsed.msg_type);
            log('error:', parsed.error ?? null);
            log('full response:', parsed);
            responses.push(parsed);
            if (responses.length >= requests.length) clearTimeout(timeout);
            // sendNext() finds no request left once responses.length reaches
            // requests.length, and closes the socket itself in that case.
            sendNext();
        };

        websocket.onclose = event => {
            log(`STEP ${step}: WebSocket closed`, { code: event.code, reason: event.reason || '(none)' });
            resolve(responses);
        };

        sendNext();
    });
};
