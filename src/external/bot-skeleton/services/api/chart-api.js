import { getStoredAccessToken } from '@/utils/auth/deriv-oauth';
import { V2GetActiveToken } from './appId';
import ConnectionManager from './connection-manager';
import { createOtpConnection } from './otp-connection';
import { wsLog } from './ws-logger';

class ChartAPI {
    api;

    // Owns socket creation/open/close listeners, reconnect backoff, and heartbeat -
    // see connection-manager.ts. This used to be a near-duplicate of api-base.ts's
    // own inline implementation.
    connection_manager = new ConnectionManager({
        label: 'chart',
        onClose: source => this.reconnectIfNotConnected(source),
    });

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
