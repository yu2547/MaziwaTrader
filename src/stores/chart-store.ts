import { action, computed, makeObservable, observable, reaction } from 'mobx';
import { LocalStore } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';
import RootStore from './root-store';

type TSubscription = {
    id: string | null;
    subscriber: null | { unsubscribe: () => void };
};

/** The fields of an active_symbols entry this store actually reads. */
type TChartSymbol = {
    exchange_is_open?: number;
    is_trading_suspended?: number;
    submarket?: string;
    symbol?: string;
};

export default class ChartStore {
    /** The market the chart falls back to - the same one every other page defaults to. */
    static DEFAULT_SYMBOL = 'R_100';

    root_store: RootStore;
    constructor(root_store: RootStore) {
        makeObservable(this, {
            symbol: observable,
            is_chart_loading: observable,
            chart_type: observable,
            granularity: observable,
            is_contract_ended: computed,
            updateSymbol: action,
            onSymbolChange: action,
            updateGranularity: action,
            updateChartType: action,
            setChartStatus: action,
            restoreFromStorage: action,
            chart_subscription_id: observable,
            setChartSubscriptionId: action,
        });

        this.root_store = root_store;
        const { run_panel } = root_store;

        reaction(
            () => run_panel.is_running,
            () => (run_panel.is_running ? this.onStartBot() : this.onStopBot())
        );

        this.restoreFromStorage();
    }

    subscription: TSubscription = {
        id: null,
        subscriber: null,
    };
    chart_subscription_id = '';

    symbol: string | undefined;
    is_chart_loading: boolean | undefined;
    chart_type: string | undefined;
    granularity: number | undefined;

    get is_contract_ended() {
        const { transactions } = this.root_store;

        return transactions.contracts.length > 0 && transactions.contracts[0].is_ended;
    }

    onStartBot = () => {
        this.updateSymbol();
    };

    // eslint-disable-next-line
    onStopBot = () => {
        // const { main_content } = this.root_store;
        // main_content.setActiveTab(tabs_title.WORKSPACE);
    };

    /**
     * Picks the market the chart opens on.
     *
     * The workspace's own market wins when there is one, so the chart follows
     * the bot being built. Otherwise it is a volatility index - a live,
     * always-open market, and the same default the rest of the app uses -
     * rather than whichever symbol Deriv happened to return first, which can
     * be a closed exchange or a suspended instrument and charts as a flat line.
     *
     * It deliberately does not assign nothing. Chart renders null without a
     * symbol, and active_symbols arrives on the connection - which comes up
     * after this store does. Overwriting a good symbol with undefined, or
     * writing undefined on the one early attempt, is what left the Charts tab
     * blank with no way back.
     */
    updateSymbol = () => {
        const workspace = window.Blockly.derivWorkspace;
        const market_block = workspace?.getAllBlocks().find((block: window.Blockly.Block) => {
            return block.type === 'trade_definition_market';
        });

        const from_workspace = market_block?.getFieldValue('SYMBOL_LIST');
        // api_base declares active_symbols as an untyped empty array, so the
        // shape it actually carries is named here rather than inferred as never.
        const all = (api_base?.active_symbols ?? []) as TChartSymbol[];
        const tradable = all.filter(item => !item.is_trading_suspended && item.exchange_is_open !== 0);
        const preferred =
            tradable.find(item => item.symbol === ChartStore.DEFAULT_SYMBOL) ??
            tradable.find(item => item.submarket === 'random_index');

        const symbol = from_workspace || preferred?.symbol || tradable[0]?.symbol;
        if (symbol) this.symbol = symbol;
    };

    onSymbolChange = (symbol: string) => {
        this.symbol = symbol;
        this.saveToLocalStorage();
    };

    updateGranularity = (granularity: number) => {
        this.granularity = granularity;
        this.saveToLocalStorage();
    };

    updateChartType = (chart_type: string) => {
        this.chart_type = chart_type;
        this.saveToLocalStorage();
    };

    setChartStatus = (status: boolean) => {
        this.is_chart_loading = status;
    };

    saveToLocalStorage = () => {
        LocalStore.set(
            'bot.chart_props',
            JSON.stringify({
                symbol: this.symbol,
                granularity: this.granularity,
                chart_type: this.chart_type,
            })
        );
    };

    restoreFromStorage = () => {
        try {
            const props = LocalStore.get('bot.chart_props');

            if (props) {
                const { symbol, granularity, chart_type } = JSON.parse(props);
                this.symbol = symbol;
                this.granularity = granularity;
                this.chart_type = chart_type;
            } else {
                this.granularity = 0;
                this.chart_type = 'line';
            }
        } catch {
            LocalStore.remove('bot.chart_props');
        }
    };

    getMarketsOrder = (active_symbols: { market: string; display_name: string }[]) => {
        const synthetic_index = 'synthetic_index';

        const has_synthetic_index = !!active_symbols.find(s => s.market === synthetic_index);
        return active_symbols
            .slice()
            .sort((a, b) => (a.display_name < b.display_name ? -1 : 1))
            .map(s => s.market)
            .reduce(
                (arr, market) => {
                    if (arr.indexOf(market) === -1) arr.push(market);
                    return arr;
                },
                has_synthetic_index ? [synthetic_index] : []
            );
    };
    setChartSubscriptionId = (chartSubscriptionId: string) => {
        this.chart_subscription_id = chartSubscriptionId;
    };
}
