import Cookies from 'js-cookie';
import CommonStore from '@/stores/common-store';
import { TAuthData } from '@/types/api-types';
import { clearAuthData } from '@/utils/auth-utils';
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

    // TEMPORARY DEBUG - remove once the connection issue is confirmed resolved.
    init_call_count = 0;

    async init(force_create_connection = false) {
        this.init_call_count += 1;
        wsLog('Connection', `api_base.init() call #${this.init_call_count}`, {
            force_create_connection,
            existing_readyState: this.api?.connection?.readyState,
            stack: new Error('init() called here').stack,
        });

        this.toggleRunButton(true);

        if (this.api) {
            this.unsubscribeAllSubscriptions();
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
            await this.authorizeAndSubscribe();
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
        const streams: Array<{ key: string; request: Record<string, unknown> }> = [
            { key: 'balance', request: { balance: 1, subscribe: 1, account: 'all' } },
            { key: 'transaction', request: { transaction: 1, subscribe: 1 } },
            { key: 'proposal_open_contract', request: { proposal_open_contract: 1, subscribe: 1 } },
        ];

        await Promise.all(streams.map(({ key, request }) => this.subscription_manager.subscribe(key, request)));
    }

    getActiveSymbols = async () => {
        await doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this).then(
            ({ active_symbols = [], error = {} }) => {
                const pip_sizes = {};
                if (active_symbols.length) this.has_active_symbols = true;
                active_symbols.forEach(({ symbol, pip }: { symbol: string; pip: string }) => {
                    (pip_sizes as Record<string, number>)[symbol] = +(+pip).toExponential().substring(3);
                });
                this.pip_sizes = pip_sizes as Record<string, number>;
                this.toggleRunButton(false);
                this.active_symbols = active_symbols;
                return active_symbols || error;
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
