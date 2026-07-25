import { generateDerivApiInstance } from './appId';
import { wsLog } from './ws-logger';

export type TDerivApiInstance = ReturnType<typeof generateDerivApiInstance>;

type TConnectionManagerConfig = {
    label: string;
    onOpen?: () => void;
    onClose?: (source: string) => void;
};

/**
 * DISCONNECTED -> CONNECTING -> CONNECTED -> AUTHORIZING -> AUTHORIZED
 *   -> RESTORING_SUBSCRIPTIONS -> READY
 *
 * The manager only drives DISCONNECTED/CONNECTING/CONNECTED itself (that's all it
 * has visibility into). AUTHORIZING/AUTHORIZED/RESTORING_SUBSCRIPTIONS/READY are
 * pushed by the owner (api_base) via setState(), since authorization and
 * subscription restoration happen above this class's responsibility - but tracking
 * them here gives one single place to ask "what stage is this connection at",
 * which is the point: it stops subscriptions from being restored before
 * authorization completes or while the socket is still connecting.
 */
export const CONNECTION_STATE = {
    DISCONNECTED: 'DISCONNECTED',
    CONNECTING: 'CONNECTING',
    CONNECTED: 'CONNECTED',
    AUTHORIZING: 'AUTHORIZING',
    AUTHORIZED: 'AUTHORIZED',
    RESTORING_SUBSCRIPTIONS: 'RESTORING_SUBSCRIPTIONS',
    READY: 'READY',
} as const;

export type TConnectionState = (typeof CONNECTION_STATE)[keyof typeof CONNECTION_STATE];

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 10000;

/**
 * Centralizes the WebSocket connection lifecycle that api-base.ts and chart-api.js
 * previously each implemented independently: creating the underlying socket, wiring
 * open/close listeners, the window 'online'/'focus' reconnect triggers, and now also
 * reconnect backoff and heartbeat/stale-socket detection (both used identically by
 * main and chart connections, so they belong here rather than duplicated per file).
 *
 * Deliberately does NOT own what happens after a *successful* reconnect (re-authorize,
 * re-subscribe, etc.) - that differs per connection (main vs chart) and stays owned
 * by the caller via the onOpen/onClose callbacks, which is what api_base.init()/
 * chart_api.init() already do.
 *
 * Fixes a latent bug from the previous per-file implementations: both called
 * `removeEventListener('close', this.onsocketclose.bind(this))`, but `.bind(this)`
 * creates a *new* function reference each time, so that remove call never matched
 * the function passed to the earlier addEventListener call - listeners silently
 * accumulated on the connection object across every reconnect. This class binds
 * its handlers once in the constructor so add/remove always reference the same
 * function.
 */
export default class ConnectionManager {
    label: string;
    api: TDerivApiInstance | null = null;
    state: TConnectionState = CONNECTION_STATE.DISCONNECTED;
    private has_registered_auto_reconnect_triggers = false;
    private handleOpen: () => void;
    private handleClose: () => void;
    private handleStale: () => void;

    // True only when the most recent teardown() was an explicit/intentional
    // disconnect (user logout, bot's "stop"/terminate connection action) rather than
    // the socket dying on its own. scheduleReconnect() checks this so an intentional
    // disconnect doesn't get silently undone by the next 'online'/'focus' event or a
    // heartbeat timeout. Cleared automatically the next time connect() runs, since a
    // fresh explicit connect() means the previous "don't reconnect" intent no longer
    // applies.
    private disconnected_intentionally = false;

    private reconnect_attempts = 0;
    private reconnect_timer: ReturnType<typeof setTimeout> | null = null;
    private heartbeat_interval: ReturnType<typeof setInterval> | null = null;
    private heartbeat_timeout: ReturnType<typeof setTimeout> | null = null;

    constructor({ label, onOpen, onClose }: TConnectionManagerConfig) {
        this.label = label;
        this.handleOpen = () => {
            wsLog('Connection', `${this.label}: connection open`);
            this.setState(CONNECTION_STATE.CONNECTED);
            this.resetBackoff();
            this.startHeartbeat();
            onOpen?.();
        };
        this.handleClose = () => {
            wsLog('Connection', `${this.label}: connection closed`);
            this.stopHeartbeat();
            this.setState(CONNECTION_STATE.DISCONNECTED);
            onClose?.('socket-close');
        };
        // A heartbeat pong that never arrives means the socket is half-open (the
        // browser hasn't noticed the underlying TCP connection is dead, so no
        // native 'close' event will ever fire on its own). Treated the same as a
        // real close: tear down the dead socket and hand off to the same onClose
        // the caller already uses to decide whether/how to reconnect.
        this.handleStale = () => {
            wsLog('Connection', `${this.label}: heartbeat detected a stale/half-open connection - forcing reconnect`);
            this.teardown();
            onClose?.('heartbeat-stale');
        };
    }

    setState(next: TConnectionState) {
        if (this.state === next) return;
        wsLog('Connection', `${this.label}: state → ${next}`);
        this.state = next;
    }

    getState() {
        return this.state;
    }

    isConnected() {
        return this.api?.connection?.readyState === 1;
    }

    /**
     * Creates a new underlying socket+api instance unless one is already open and
     * `force` is not set. Returns true if a new instance was created.
     */
    connect(force = false) {
        if (!this.api || !this.isConnected() || force) {
            this.teardown();
            this.setState(CONNECTION_STATE.CONNECTING);
            this.api = generateDerivApiInstance();
            this.api?.connection.addEventListener('open', this.handleOpen);
            this.api?.connection.addEventListener('close', this.handleClose);
            return true;
        }
        return false;
    }

    /**
     * Tears down the current socket. `intentional` marks this as a deliberate
     * disconnect (logout, bot terminate) so scheduleReconnect() won't fire for it -
     * pass true from any caller that means "stop trying to stay connected".
     */
    teardown(intentional = false) {
        this.disconnected_intentionally = intentional;
        this.cancelScheduledReconnect();
        this.stopHeartbeat();
        if (intentional) {
            wsLog('Connection', `${this.label}: intentional disconnect - auto-reconnect disabled until next connect()`);
        }
        if (this.api?.connection) {
            this.api.disconnect();
            this.api.connection.removeEventListener('open', this.handleOpen);
            this.api.connection.removeEventListener('close', this.handleClose);
        }
        this.setState(CONNECTION_STATE.DISCONNECTED);
    }

    /** Registers window 'online'/'focus' listeners that invoke the given check, once only. */
    registerAutoReconnectTriggers(onTrigger: (source: string) => void) {
        if (typeof window === 'undefined' || this.has_registered_auto_reconnect_triggers) return;
        window.addEventListener('online', () => onTrigger('online'));
        window.addEventListener('focus', () => onTrigger('focus'));
        this.has_registered_auto_reconnect_triggers = true;
    }

    /**
     * Schedules a reconnect attempt with exponential backoff (1s, 2s, 4s, 8s, 16s,
     * capped at 30s). No-ops if the last disconnect was intentional, or if a
     * reconnect is already scheduled (so a close event and a heartbeat timeout
     * arriving close together can't stack two attempts).
     */
    scheduleReconnect(reconnectFn: () => void) {
        if (this.disconnected_intentionally) {
            wsLog('Reconnect', `${this.label}: skipped - last disconnect was intentional`);
            return;
        }
        if (this.reconnect_timer) {
            wsLog('Reconnect', `${this.label}: attempt already scheduled - ignoring duplicate trigger`);
            return;
        }

        this.reconnect_attempts += 1;
        const delay_ms = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnect_attempts - 1), RECONNECT_MAX_DELAY_MS);
        wsLog('Reconnect', `${this.label}: attempt #${this.reconnect_attempts}, delay ${Math.round(delay_ms / 1000)}s`);

        this.reconnect_timer = setTimeout(() => {
            this.reconnect_timer = null;
            reconnectFn();
        }, delay_ms);
    }

    cancelScheduledReconnect() {
        if (this.reconnect_timer) {
            clearTimeout(this.reconnect_timer);
            this.reconnect_timer = null;
        }
    }

    private resetBackoff() {
        if (this.reconnect_attempts > 0) {
            wsLog('Reconnect', `${this.label}: success - backoff reset`);
        }
        this.reconnect_attempts = 0;
        this.cancelScheduledReconnect();
    }

    /**
     * Sends a `ping` on an interval while connected and expects a `pong` back
     * within HEARTBEAT_TIMEOUT_MS. A missed/failed pong means the socket is stale
     * or half-open (the browser's readyState still says OPEN but nothing is
     * actually getting through) - something a native 'close' listener alone would
     * never catch, since no close event fires until (if ever) the OS notices.
     */
    private startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeat_interval = setInterval(() => {
            if (!this.api || !this.isConnected()) return;

            wsLog('Heartbeat', `${this.label}: ping sent`);
            let settled = false;

            this.heartbeat_timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                wsLog('Heartbeat', `${this.label}: pong timeout - treating connection as stale`);
                this.handleStale();
            }, HEARTBEAT_TIMEOUT_MS);

            Promise.resolve(this.api?.send({ ping: 1 }))
                .then(() => {
                    if (settled) return;
                    settled = true;
                    if (this.heartbeat_timeout) clearTimeout(this.heartbeat_timeout);
                    wsLog('Heartbeat', `${this.label}: pong received`);
                })
                .catch(() => {
                    if (settled) return;
                    settled = true;
                    if (this.heartbeat_timeout) clearTimeout(this.heartbeat_timeout);
                    wsLog('Heartbeat', `${this.label}: ping failed - treating connection as stale`);
                    this.handleStale();
                });
        }, HEARTBEAT_INTERVAL_MS);
    }

    private stopHeartbeat() {
        if (this.heartbeat_interval) {
            clearInterval(this.heartbeat_interval);
            this.heartbeat_interval = null;
        }
        if (this.heartbeat_timeout) {
            clearTimeout(this.heartbeat_timeout);
            this.heartbeat_timeout = null;
        }
    }
}
