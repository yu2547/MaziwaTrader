import ConnectionManager from './connection-manager';

class ChartAPI {
    api;

    // Owns socket creation/open/close listeners - see connection-manager.ts. This
    // used to be a near-duplicate of api-base.ts's own inline implementation.
    connection_manager = new ConnectionManager({
        label: 'chart',
        onClose: () => this.reconnectIfNotConnected(),
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

    reconnectIfNotConnected = () => {
        if (this.connection_manager.api?.connection?.readyState && this.connection_manager.api.connection.readyState > 1) {
            // eslint-disable-next-line no-console
            console.log('[WS DEBUG][chart] Info: Chart connection to the server was closed, trying to reconnect.');
            this.init(true);
        }
    };
}

const chart_api = new ChartAPI();

export default chart_api;
