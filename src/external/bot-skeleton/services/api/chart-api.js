import ConnectionManager from './connection-manager';
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

    init = async (force_create_connection = false) => {
        this.connection_manager.connect(force_create_connection);
        this.api = this.connection_manager.api;
        this.getTime();
    };

    getTime() {
        if (!this.time_interval) {
            this.time_interval = setInterval(() => {
                this.api.send({ time: 1 });
            }, 30000);
        }
    }

    reconnectIfNotConnected = source => {
        if (this.connection_manager.api?.connection?.readyState && this.connection_manager.api.connection.readyState > 1) {
            wsLog('Connection', `chart: connection was closed, scheduling reconnect (source=${source ?? 'unknown'})`);
            this.connection_manager.scheduleReconnect(() => this.init(true));
        }
    };
}

const chart_api = new ChartAPI();

export default chart_api;
