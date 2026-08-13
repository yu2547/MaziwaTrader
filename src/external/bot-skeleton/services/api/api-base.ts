import Cookies from 'js-cookie';
import CommonStore from '@/stores/common-store';
import { TAuthData } from '@/types/api-types';
import { getStoredAccessToken, getStoredSelectedAccountId } from '@/utils/auth/deriv-oauth';
import { clearAuthData } from '@/utils/auth-utils';
import type { TOptionsAccount } from '@/utils/options-trading/options-trading-api';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import {
    CONNECTION_STATUS,
    setAccountList,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from './appId';
import chart_api from './chart-api';
import ConnectionManager, { CONNECTION_STATE } from './connection-manager';
import { createOtpConnection } from './otp-connection';
import SubscriptionManager from './subscription-manager';
import { wsLog } from './ws-logger';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

type TApiBaseApi = {
    connection: {
        readyState: keyof typeof socket_state;
        addEventListener: (event: string, callback: () => void) => void;
        removeEventListener: (event: string, callback: () => void) => void;
    };
    send: (data: unknown) => void;
    disconnect: () => void;
    authorize: (token: string) => Promise<{ authorize: TAuthData; error: unknown }>;
    getSelfExclusion: () => Promise<unknown>;
    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => {
            unsubscribe: () => void;
        };
    };
} & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<void> | null = null;
    common_store: CommonStore | undefined;
    landing_company: string | null = null;

    // Set only by initOtpConnection() below, never by the classic
    // authorizeAndSubscribe() path. This is the "preserve the distinction
    // internally" seam: is_authorized (above) is a generic internal
    // readiness flag safe to set from either transport, but nothing here
    // mirrors classic authorize()-response data (account_list/country/
    // scopes/etc via setAccountList/setAuthData) - that stays exclusively
    // classic-sourced, since an OTP connection never receives an authorize
    // response to source it from. Code that needs to tell which transport
    // is live reads this flag, not isAuthorized$.
    is_otp_transport = false;
    otp_account: TOptionsAccount | null = null;

    // Single mutable slot (not an accumulating event list) for "something wants to
    // know when subscriptions have just been restored after a reconnect". Kept as
    // a single overwritable callback rather than the Observer/globalObserver event
    // bus: TradeEngine is recreated on every bot run, and registering a new
    // Observer listener each time without ever unregistering the old one would
    // itself be a new listener leak - exactly the class of bug this whole effort
    // is fixing. The current TradeEngine simply overwrites this on construction.
    private reconnected_callback: (() => void) | null = null;

    onReconnected(callback: () => void) {
        this.reconnected_callback = callback;
    }

    // Owns balance/transaction/proposal_open_contract: dedupes duplicate subscribe
    // calls, and replays them in order after a reconnect (restoreAll()). See
    // subscription-manager.ts. Fixes a gap the architecture audit found: the server
    // side subscribe requests were already being re-sent on reconnect via
    // authorizeAndSubscribe() re-running, but nothing tracked *what* was active
    // before the disconnect in order to restore it deliberately/in order/exactly
    // once.
    subscription_manager = new SubscriptionManager(request => doUntilDone(() => this.api?.send(request), [], this));

    unsubscribeAllSubscriptions = () => {
        this.current_auth_subscriptions?.forEach(subscription_promise => {
            subscription_promise.then(({ subscription }) => {
                if (subscription?.id) {
                    this.api?.send({
                        forget: subscription.id,
                    });
                }
            });
        });
        this.current_auth_subscriptions = [];

        // Best-effort forget of the subscription-manager-tracked streams too - the
        // old socket may already be gone, in which case this is a harmless no-op.
        this.subscription_manager.getActiveSubscriptionIds().forEach(id => {
            this.api?.send({ forget: id });
        });
        this.subscription_manager.markAllInactive();
    };

    // Owns socket creation, open/close listeners, and the online/focus reconnect
    // triggers - see connection-manager.ts for why this replaced the previous
    // inline implementation (duplicated in chart-api.js, and had a listener leak).
    connection_manager = new ConnectionManager({
        label: 'main',
        onOpen: () => setConnectionStatus(CONNECTION_STATUS.OPENED),
        onClose: source => {
            setConnectionStatus(CONNECTION_STATUS.CLOSED);
            this.reconnectIfNotConnected(source);
        },
    });

    async init(force_create_connection = false) {
        this.toggleRunButton(true);

        if (this.api) {
            this.unsubscribeAllSubscriptions();
        }

        // OTP branch - only attempted when there is no classic token at all.
        // A classic token always takes the untouched path below, unchanged,
        // so this can never intercept a classic session. Structured as an
        // early return (rather than wrapping the classic branch in a
        // condition) so the classic code beneath this block stays a literal,
        // line-for-line no-diff - easiest to verify that nothing about it
        // changed.
        if (!V2GetActiveToken() && getStoredAccessToken()) {
            const otp_connected = await this.initOtpConnection();
            if (otp_connected) {
                this.initEventListeners();
                if (this.time_interval) clearInterval(this.time_interval);
                this.time_interval = null;
                chart_api.init(force_create_connection);
                return;
            }
            // No demo Options account yet (or the OTP request failed) - fall
            // through to the classic/anonymous connection below, exactly
            // what an unauthenticated session gets today. Does not retry
            // here; the next init() call (e.g. next page load, or a
            // reconnect) will attempt OTP again.
            wsLog('Connection', 'api_base.init(): OTP connection unavailable, falling back to anonymous connection');
        }

        const created_new_connection = this.connection_manager.connect(force_create_connection);
        if (created_new_connection) {
            ApiHelpers.disposeInstance();
            setConnectionStatus(CONNECTION_STATUS.CLOSED);
        } else {
            wsLog('Connection', 'api_base.init() reused existing OPEN connection, no new socket created');
        }
        this.api = this.connection_manager.api;

        if (!this.has_active_symbols && !V2GetActiveToken()) {
            this.active_symbols_promise = this.getActiveSymbols();
        }

        this.initEventListeners();

        if (this.time_interval) clearInterval(this.time_interval);
        this.time_interval = null;

        if (V2GetActiveToken()) {
            setIsAuthorizing(true);
            const classic_auth_error = await this.authorizeAndSubscribe();

            // A classic token that no longer authorizes must not strand an
            // OAuth session on a dead connection. Previously the OTP branch
            // above was skipped whenever *any* authToken existed, so a single
            // stale/revoked value - or anything that writes one, such as
            // useTMB's session detection - silently disabled live trading
            // with no visible error, leaving only an endless reconnect loop.
            // Classic sessions that authorize normally never reach this, so
            // a working classic session is still never intercepted, and OTP
            // is still never preferred over one.
            if ((classic_auth_error || !this.is_authorized) && getStoredAccessToken()) {
                wsLog('Connection', 'classic authorize failed - falling back to the OTP transport');
                const otp_connected = await this.initOtpConnection();
                if (otp_connected) {
                    chart_api.init(force_create_connection);
                    return;
                }
            }
        }

        chart_api.init(force_create_connection);
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    // intentional=true: an explicit disconnect (bot's terminate-connection action,
    // or the logout flow in client-store.ts) should not trigger auto-reconnect.
    terminate() {
        this.connection_manager.teardown(true);
    }

    initEventListeners() {
        // registerAutoReconnectTriggers is itself guarded to only attach once - see
        // connection-manager.ts. Previously this method managed that guard inline and
        // called it on every init() (including every reconnect) without ever removing
        // the prior listener, so 'online'/'focus' handlers accumulated on window.
        this.connection_manager.registerAutoReconnectTriggers(source => this.reconnectIfNotConnected(source));
    }

    async createNewInstance(account_id: string) {
        if (this.account_id !== account_id) {
            await this.init();
        }
    }

    reconnectIfNotConnected = (source?: string | Event) => {
        // Identifies which trigger (socket close, window 'online'/'focus', or a
        // heartbeat-detected stale socket) caused this reconnect check.
        const source_label = typeof source === 'string' ? source : (source?.type ?? 'unknown');
        wsLog('Connection', `reconnectIfNotConnected called (source=${source_label})`, {
            readyState: this.api?.connection?.readyState,
        });
        if (this.api?.connection?.readyState && this.api?.connection?.readyState > 1) {
            this.connection_manager.scheduleReconnect(() => this.init(true));
        }
    };

    async authorizeAndSubscribe() {
        const token = V2GetActiveToken();
        if (!token || !this.api) return;
        this.token = token;
        this.account_id = V2GetActiveClientId() ?? '';
        setIsAuthorizing(true);
        setIsAuthorized(false);
        this.connection_manager.setState(CONNECTION_STATE.AUTHORIZING);

        try {
            const { authorize, error } = await this.api.authorize(this.token);
            if (error) {
                if (error.code === 'InvalidToken') {
                    const is_tmb_enabled = window.is_tmb_enabled === true;
                    if (Cookies.get('logged_state') === 'true' && !is_tmb_enabled) {
                        globalObserver.emit('InvalidToken', { error });
                    } else {
                        clearAuthData();
                    }
                } else {
                    console.error('Authorization error:', error);
                }
                setIsAuthorizing(false);
                return error;
            }

            this.account_info = authorize;
            setAccountList(authorize?.account_list || []);
            setAuthData(authorize);
            setIsAuthorized(true);
            this.is_authorized = true;
            this.connection_manager.setState(CONNECTION_STATE.AUTHORIZED);
            localStorage.setItem('client_account_details', JSON.stringify(authorize?.account_list));
            localStorage.setItem('client.country', authorize?.country);

            if (this.has_active_symbols) {
                this.toggleRunButton(false);
            } else {
                this.active_symbols_promise = this.getActiveSymbols();
            }
            // Awaited (previously fire-and-forget) so RESTORING_SUBSCRIPTIONS/READY
            // and the reconnected callback only fire once subscriptions are
            // actually back, not merely requested.
            await this.subscribe();
            this.connection_manager.setState(CONNECTION_STATE.READY);
            // Tells whatever has its own listeners bound to the (now-replaced)
            // socket's message stream - TradeEngine's observeBalance/Proposals/
            // OpenContract, ticks_service.js - to rebind against the current
            // this.api. Harmless on a first connect too; nothing is registered yet.
            this.reconnected_callback?.();
            // this.getSelfExclusion(); commented this so we dont call it from two places
        } catch (e) {
            console.error('Authorization failed:', e);
            this.is_authorized = false;
            clearAuthData();
            setIsAuthorized(false);
            globalObserver.emit('Error', e);
        } finally {
            setIsAuthorizing(false);
        }
    }

    /**
     * OTP counterpart of authorizeAndSubscribe() - called only from init(),
     * only when there is no classic token but a completed OAuth session
     * exists. Returns true once the OTP connection is fully ready (mirrors
     * authorizeAndSubscribe() reaching CONNECTION_STATE.READY); returns
     * false (never throws) if it could not connect, so init() can fall back
     * to the classic/anonymous path the same way an unauthenticated session
     * is handled today.
     *
     * Deliberately does NOT call setIsAuthorized/setAccountList/setAuthData
     * - see the is_otp_transport field comment above. Fields other code
     * actually depends on that classic authorize() would normally populate
     * are set here from their real OAuth/REST source instead:
     *   - account_info.loginid / .currency (OpenContract.js reads
     *     account_info.loginid) <- the real Options account_id/currency
     *     from the OTP connection result, not fabricated.
     *   - is_authorized / account_id <- same real source.
     * account_list/country/scopes have no OAuth/REST equivalent available
     * yet and are intentionally left unset rather than guessed at.
     */
    async initOtpConnection(preferred_account_id = getStoredSelectedAccountId()): Promise<boolean> {
        try {
            const result = await createOtpConnection(preferred_account_id);
            this.connection_manager.attach(result.api);
            this.api = this.connection_manager.api;
            this.token = '';
            this.account_id = result.account.account_id;
            this.account_info = {
                loginid: result.account.account_id,
                currency: result.account.currency,
                is_virtual: result.account.account_type === 'demo' ? 1 : 0,
            };
            this.is_otp_transport = true;
            this.otp_account = result.account;
            this.is_authorized = true;
            this.connection_manager.setState(CONNECTION_STATE.AUTHORIZED);

            if (this.has_active_symbols) {
                this.toggleRunButton(false);
            } else {
                this.active_symbols_promise = this.getActiveSymbols();
            }

            await this.subscribe();
            this.connection_manager.setState(CONNECTION_STATE.READY);
            this.reconnected_callback?.();
            wsLog('Connection', 'initOtpConnection() ready', {
                account_id: result.account.account_id,
                currency: result.account.currency,
            });
            return true;
        } catch (e) {
            wsLog('Connection', 'initOtpConnection() failed', e);
            this.is_otp_transport = false;
            this.otp_account = null;
            this.is_authorized = false;
            return false;
        }
    }

    /**
     * Re-runs the OTP connection against a different Options account, for the
     * Real/Demo switch in the header. Necessary because the OTP is issued for
     * one specific account_id at socket-open and cannot be re-pointed on a
     * live socket - so "switch account" genuinely means "reconnect".
     *
     * Without this, switching to Real would only change the balance on screen
     * while the bot kept trading the previously connected account. Refuses
     * mid-run for the same reason: swapping the socket under a running bot
     * would strand its open contract on the old connection.
     */
    async switchOtpAccount(account_id: string): Promise<boolean> {
        if (!this.is_otp_transport || !account_id || account_id === this.account_id) return false;
        if (this.is_running) {
            wsLog('Connection', 'switchOtpAccount() ignored - the bot is running', { account_id });
            return false;
        }
        wsLog('Connection', 'switchOtpAccount() reconnecting', { from: this.account_id, to: account_id });
        return this.initOtpConnection(account_id);
    }

    async getSelfExclusion() {
        if (!this.api || !this.is_authorized) return;
        await this.api.getSelfExclusion();
        // TODO: fix self exclusion
    }

    async subscribe() {
        // Restore path (reconnect - subscription_manager already has entries from
        // before the disconnect, marked inactive by unsubscribeAllSubscriptions()):
        // re-send each one, in the order they were originally registered.
        if (this.subscription_manager.hasEntries()) {
            this.connection_manager.setState(CONNECTION_STATE.RESTORING_SUBSCRIPTIONS);
            await this.subscription_manager.restoreAll();
            return;
        }

        // First-connect path: register each stream for the first time.
        // 'account: all' asks the classic API to aggregate every login the
        // token covers - meaningless for an OTP connection, which is already
        // scoped to exactly one Options account by construction, and
        // untested whether the OTP socket even accepts it. Omitted only for
        // the OTP transport; the classic request is byte-for-byte unchanged.
        const streams: Array<{ key: string; request: Record<string, unknown> }> = [
            {
                key: 'balance',
                request: this.is_otp_transport
                    ? { balance: 1, subscribe: 1 }
                    : { balance: 1, subscribe: 1, account: 'all' },
            },
            { key: 'transaction', request: { transaction: 1, subscribe: 1 } },
            { key: 'proposal_open_contract', request: { proposal_open_contract: 1, subscribe: 1 } },
        ];

        await Promise.all(streams.map(({ key, request }) => this.subscription_manager.subscribe(key, request)));
    }

    getActiveSymbols = async () => {
        await doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this).then(
            ({ active_symbols = [], error = {} }) => {
                // The OTP transport describes instruments differently from the
                // classic API: it labels them `underlying_symbol` rather than
                // `symbol` (confirmed live - see
                // docs/DERIV_OAUTH_LEGACY_TOKEN_BRIDGE_REPORT.md section 8.4),
                // and it omits the *_display_name fields entirely.
                //
                // active-symbols.js builds the Market > Submarket > Symbol tree
                // behind the Blockly dropdowns straight from these fields, so a
                // missing `symbol` leaves the bot with no market to trade, and
                // missing display names render every option as "undefined"
                // (which is what the market dropdown showed: several distinct
                // entries, all unlabelled - the keys were there, the labels
                // were not).
                //
                // Each field is only filled when absent, so a classic response
                // passes through untouched. Labels fall back to a humanised
                // form of the key the API did send, which is worse-looking than
                // Deriv's own copy but is accurate and, unlike "undefined",
                // selectable.
                const humanize = (value: unknown) =>
                    typeof value === 'string' && value
                        ? value.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
                        : undefined;

                const normalized_symbols = (active_symbols as Array<Record<string, unknown>>).map(active_symbol => {
                    const symbol = active_symbol.symbol ?? active_symbol.underlying_symbol;
                    return {
                        ...active_symbol,
                        symbol,
                        display_name: active_symbol.display_name ?? humanize(symbol) ?? symbol,
                        market_display_name:
                            active_symbol.market_display_name ?? humanize(active_symbol.market) ?? active_symbol.market,
                        submarket_display_name:
                            active_symbol.submarket_display_name ??
                            humanize(active_symbol.submarket) ??
                            active_symbol.submarket,
                    };
                });

                const pip_sizes = {};
                if (normalized_symbols.length) this.has_active_symbols = true;
                normalized_symbols.forEach(({ symbol, pip }: { symbol?: unknown; pip?: unknown }) => {
                    (pip_sizes as Record<string, number>)[symbol as string] = +(+(pip as string))
                        .toExponential()
                        .substring(3);
                });
                this.pip_sizes = pip_sizes as Record<string, number>;
                this.toggleRunButton(false);
                this.active_symbols = normalized_symbols as never;
                return normalized_symbols || error;
            }
        );
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        (run_button as HTMLButtonElement).disabled = toggle;
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];

        // Resetting timeout resolvers
        const global_timeouts = globalObserver.getState('global_timeouts') ?? [];

        global_timeouts.forEach((_: unknown, i: number) => {
            clearTimeout(i);
        });
    }
}

export const api_base = new APIBase();
