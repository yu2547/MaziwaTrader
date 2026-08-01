import { getAppId } from '@/components/shared';

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
    | 'invalid_response';

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
