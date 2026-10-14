import { getStoredAccessToken } from '@/utils/auth/deriv-oauth';
import { V2GetActiveToken } from './appId';
import ConnectionManager from './connection-manager';
import { createOtpConnection } from './otp-connection';
import { wsLog } from './ws-logger';

class ChartAPI {
    api;

    /**
     * Things that need to know this socket has been replaced.
     *
     * The heartbeat and the reconnect below bring the connection back, but a
     * new socket is a blank one: anything subscribed to the old socket's
     * message stream is now listening to a dead object, and the server-side
     * streams it had asked for belonged to that socket too. api_base solves
     * the same problem with subscription_manager.restoreAll() plus a
     * reconnected callback; this connection had neither, so the chart came
     * back connected and permanently silent - the tick pointer stopped and
     * only a page reload fixed it.
     *
     * A set with an unsubscribe, rather than api_base's single overwritable
     * slot: the consumer here is a React effect that can mount more than once
     * over a session, and returning the remover from the effect is what keeps
     * this from becoming the listener leak that the single slot was avoiding.
     */
    reconnect_listeners = new Set();

    // The first open is the connection being established, not a reconnection,
    // and nothing has subscribed yet for it to tell.
    has_opened_once = false;

    // Owns socket creation/open/close listeners, reconnect backoff, and heartbeat -
    // see connection-manager.ts. This used to be a near-duplicate of api-base.ts's
    // own inline implementation.
    connection_manager = new ConnectionManager({
        label: 'chart',
        onOpen: () => this.handleOpen(),
        onClose: source => this.reconnectIfNotConnected(source),
    });

    handleOpen = () => {
        if (!this.has_opened_once) {
            this.has_opened_once = true;
            return;
        }

        wsLog('Connection', `chart: socket replaced - notifying ${this.reconnect_listeners.size} listener(s)`);
        this.reconnect_listeners.forEach(callback => {
            try {
                callback();
            } catch (error) {
                // One listener failing must not stop the others from being
                // restored, and must not throw inside the socket's open event.
                wsLog('Connection', 'chart: a reconnect listener threw', error);
            }
        });
    };

    /**
     * Registers a listener for "the socket was replaced"; returns its remover.
     *
     * The remover returns nothing on purpose. Set.delete() answers with a
     * boolean, and this is meant to be handed straight back from a React
     * effect, whose cleanup has to be void - returning the delete's result
     * made it an invalid destructor.
     */
    onReconnected = callback => {
        this.reconnect_listeners.add(callback);
        return () => {
            this.reconnect_listeners.delete(callback);
        };
    };

    // True once an OTP session has been detected, so a later reconnect never
    // silently falls back to the classic endpoint this connection used to
    // default to.
    is_otp_session = false;

    init = async (force_create_connection = false) => {
        // This is a second socket, independent of api_base's. On an OAuth
        // session the classic endpoint it used to open unconditionally is
        // unreachable, so it never connected - it just retried forever
        // (attempt #4, #5, ... every close), filling the console and burning
        // a reconnect timer for a connection that could never succeed.
        // Deliberately checks the session the same way api_base.init() does
        // rather than importing api_base, which would be a circular import.
        if (!V2GetActiveToken() && getStoredAccessToken()) {
            this.is_otp_session = true;
            try {
                const { api } = await createOtpConnection();
                this.connection_manager.attach(api);
                this.api = this.connection_manager.api;
                this.getTime();
            } catch (error) {
                // Chart data is unavailable for this session, which is a far
                // better outcome than an endless reconnect loop against an
                // endpoint that is known not to answer.
                wsLog('Connection', 'chart: OTP connection unavailable - chart data disabled for this session', error);
            }
            return;
        }

        this.connection_manager.connect(force_create_connection);
        this.api = this.connection_manager.api;
        this.getTime();
    };

    getTime() {
        if (!this.time_interval) {
            this.time_interval = setInterval(() => {
                this.api?.send({ time: 1 });
            }, 30000);
        }
    }

    reconnectIfNotConnected = source => {
        if (
            this.connection_manager.api?.connection?.readyState &&
            this.connection_manager.api.connection.readyState > 1
        ) {
            wsLog('Connection', `chart: connection was closed, scheduling reconnect (source=${source ?? 'unknown'})`);
            // An OTP socket is reconnected by minting a fresh OTP, not by
            // reopening the old URL - init() handles that, and each attempt
            // still goes through the same backoff.
            this.connection_manager.scheduleReconnect(() => this.init(!this.is_otp_session));
        }
    };
}

const chart_api = new ChartAPI();

export default chart_api;
