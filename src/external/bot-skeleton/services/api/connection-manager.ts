import { generateDerivApiInstance } from './appId';

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

/**
 * Centralizes the WebSocket connection lifecycle that api-base.ts and chart-api.js
 * previously each implemented independently: creating the underlying socket, wiring
 * open/close listeners, and registering the window 'online'/'focus' reconnect triggers.
 *
 * Deliberately does NOT own reconnect *decisions* or what happens after a reconnect
 * (re-authorize, re-subscribe, restart timers, etc.) - those differ per connection
 * (main vs chart) and stay owned by the caller via the onOpen/onClose callbacks,
 * which is what api_base.init()/chart_api.init() already do.
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

    constructor({ label, onOpen, onClose }: TConnectionManagerConfig) {
        this.label = label;
        this.handleOpen = () => {
            // eslint-disable-next-line no-console
            console.log(`[WS DEBUG][${this.label}] connection open`);
            this.setState(CONNECTION_STATE.CONNECTED);
            onOpen?.();
        };
        this.handleClose = () => {
            // eslint-disable-next-line no-console
            console.log(`[WS DEBUG][${this.label}] connection closed`);
            this.setState(CONNECTION_STATE.DISCONNECTED);
            onClose?.('socket-close');
        };
    }

    setState(next: TConnectionState) {
        if (this.state === next) return;
        // eslint-disable-next-line no-console
        console.log(`[WS DEBUG][${this.label}] state: ${this.state} -> ${next}`);
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

    teardown() {
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
}
