import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import { useStore } from '@/hooks/useStore';
import {
    ActiveSymbolsRequest,
    ServerTimeRequest,
    TicksHistoryResponse,
    TicksStreamRequest,
    TradingTimesRequest,
} from '@deriv/api-types';
import { ChartTitle, SmartChart } from '@deriv/deriv-charts';
import { useDevice } from '@deriv-com/ui';
import ToolbarWidgets from './toolbar-widgets';
import '@deriv/deriv-charts/dist/smartcharts.css';

type TSubscription = {
    [key: string]: null | {
        unsubscribe?: () => void;
    };
};

type TError = null | {
    error?: {
        code?: string;
        message?: string;
    };
};

const subscriptions: TSubscription = {};

// Hoisted to module scope: always the same empty array / no-op, so SmartChart
// gets a genuinely stable reference across every re-render of Chart instead of a
// fresh (but value-identical) one each time. Ticks themselves never flow through
// these props or through a Chart re-render at all - chart_store's only observable
// fields are symbol/granularity/chart_type/is_chart_loading/chart_subscription_id
// (confirmed by reading chart-store.ts), and requestSubscribe's callback is called
// directly by chart_api's onMessage listener, bypassing React/MobX entirely for
// the actual tick stream. This file only concerns the comparatively rare
// re-renders that already do happen - symbol/granularity/theme/drawer changes -
// and makes sure those don't also hand SmartChart new-looking props it didn't
// actually need to react to.
const EMPTY_BARRIERS: [] = [];
const noop = () => {};

const Chart = observer(({ show_digits_stats }: { show_digits_stats: boolean }) => {
    const { common, ui } = useStore();
    const { chart_store, run_panel, dashboard } = useStore();
    const [isSafari, setIsSafari] = useState(false);

    const {
        chart_type,
        getMarketsOrder,
        granularity,
        onSymbolChange,
        setChartStatus,
        symbol,
        updateChartType,
        updateGranularity,
        updateSymbol,
        setChartSubscriptionId,
        chart_subscription_id,
    } = chart_store;
    const chartSubscriptionIdRef = useRef(chart_subscription_id);

    // The last stream SmartChart asked for, kept so it can be asked for again
    // on a replaced socket. A ref rather than state: nothing renders from it,
    // and writing it must not cost a render on every subscribe.
    const last_subscribe_ref = useRef<{ callback: (data: any) => void; req: TicksStreamRequest } | null>(null);
    const { isDesktop, isMobile } = useDevice();
    const { is_drawer_open } = run_panel;
    const { is_chart_modal_visible } = dashboard;
    // Memoized so SmartChart only sees a new settings object when one of these
    // actual values changes, not on every re-render of Chart (e.g. a drawer-open
    // toggle, which touches none of these).
    const settings = useMemo(
        () => ({
            assetInformation: false, // ui.is_chart_asset_info_visible,
            countdown: true,
            isHighestLowestMarkerEnabled: false, // TODO: Pending UI,
            language: common.current_language.toLowerCase(),
            position: ui.is_chart_layout_default ? 'bottom' : 'left',
            theme: ui.is_dark_mode_on ? 'dark' : 'light',
        }),
        [common.current_language, ui.is_chart_layout_default, ui.is_dark_mode_on]
    );

    useEffect(() => {
        // Safari browser detection
        const isSafariBrowser = () => {
            const ua = navigator.userAgent.toLowerCase();
            return ua.indexOf('safari') !== -1 && ua.indexOf('chrome') === -1 && ua.indexOf('android') === -1;
        };

        setIsSafari(isSafariBrowser());

        return () => {
            // chart_api.api is undefined whenever the chart connection never
            // established - which an OAuth session reaches by design, since
            // chart-api.ts disables chart data rather than retrying an
            // endpoint that cannot answer. Unguarded, this cleanup threw while
            // navigating away from Charts, and the router's error boundary
            // then replaced the whole route subtree - Layout, header and
            // navigation included. ticks_service.js already guards the same
            // call the same way.
            chart_api.api?.forgetAll('ticks');
        };
    }, []);

    useEffect(() => {
        chartSubscriptionIdRef.current = chart_subscription_id;
    }, [chart_subscription_id]);

    // Keeps asking until there is a symbol. active_symbols arrives on the
    // trading connection, which routinely comes up after this mounts - so the
    // single attempt this used to make could land before there was anything to
    // choose from, and the tab then stayed blank for the rest of the session.
    // Once a symbol exists the effect re-runs, returns early, and the interval
    // is cleared.
    useEffect(() => {
        if (symbol) return undefined;
        updateSymbol();
        const timer = setInterval(updateSymbol, 1000);
        return () => clearInterval(timer);
    }, [symbol, updateSymbol]);

    // requestAPI/requestForgetStream/requestSubscribe are all passed as props to
    // SmartChart below - wrapped in useCallback so those props stay reference-stable
    // across re-renders that don't actually need SmartChart to treat them as new
    // (chart_api is a module-level singleton; chartSubscriptionIdRef is a ref, so
    // reading .current doesn't need to be a dependency; setChartSubscriptionId is a
    // MobX action, stable for the store's lifetime). No logic changed - same
    // requests, same subscribe/forget calls, same callback invocation.
    const requestAPI = useCallback((req: ServerTimeRequest | ActiveSymbolsRequest | TradingTimesRequest) => {
        return chart_api.api.send(req);
    }, []);

    const requestForgetStream = useCallback((subscription_id: string) => {
        subscription_id && chart_api.api.forget(subscription_id);
    }, []);

    const requestSubscribe = useCallback(
        async (req: TicksStreamRequest, callback: (data: any) => void) => {
            try {
                // Held so the stream can be asked for again on a new socket -
                // see the reconnect effect below. SmartChart calls this once
                // per symbol/granularity and then expects ticks to keep
                // arriving, so this is the only record of what it asked for.
                last_subscribe_ref.current = { callback, req };
                requestForgetStream(chartSubscriptionIdRef.current);
                const history = await chart_api.api.send(req);
                setChartSubscriptionId(history?.subscription.id);
                if (history) callback(history);
                if (req.subscribe === 1) {
                    subscriptions[history?.subscription.id] = chart_api.api
                        .onMessage()
                        ?.subscribe(({ data }: { data: TicksHistoryResponse }) => {
                            callback(data);
                        });
                }
            } catch (e) {
                // eslint-disable-next-line no-console
                (e as TError)?.error?.code === 'MarketIsClosed' && callback([]); //if market is closed sending a empty array  to resolve
                console.log((e as TError)?.error?.message);
            }
        },
        [requestForgetStream, setChartSubscriptionId]
    );

    // Re-asks for the tick stream whenever the chart's socket is replaced.
    //
    // Without this the chart reconnects and then stays silent for the rest of
    // the session: the rxjs listener in requestSubscribe is bound to the socket
    // that existed when SmartChart first subscribed, and the ticks_history
    // stream it asked for belonged to that socket too. Both die with it,
    // SmartChart has no idea anything happened, and the only cure was reloading
    // the page - which is exactly what the frozen tick pointer was.
    //
    // Replays the last request rather than trying to revive the old
    // subscription: its id names a stream on a socket that no longer exists,
    // so there is nothing on the new one to forget or resume.
    //
    // Placed below requestSubscribe rather than beside the other effects
    // because it depends on it - read before it is initialised, the dependency
    // array alone would throw during render.
    useEffect(
        () =>
            chart_api.onReconnected(() => {
                const last = last_subscribe_ref.current;
                if (!last) return;

                Object.keys(subscriptions).forEach(id => {
                    subscriptions[id]?.unsubscribe?.();
                    delete subscriptions[id];
                });

                // Cleared before replaying so requestSubscribe does not try to
                // forget the dead socket's id on the new connection.
                chartSubscriptionIdRef.current = '';
                setChartSubscriptionId('');

                requestSubscribe(last.req, last.callback);
            }),
        [requestSubscribe, setChartSubscriptionId]
    );

    // Same reasoning as requestAPI/requestSubscribe above - stable references for
    // props SmartChart receives, not new behavior. setChartStatus/updateChartType/
    // updateGranularity/onSymbolChange are all MobX actions (stable for the store's
    // lifetime); isDesktop is the only real dependency that can legitimately change
    // (on viewport resize).
    const chartStatusListener = useCallback((v: boolean) => setChartStatus(!v), [setChartStatus]);
    const toolbarWidget = useCallback(
        () => (
            <ToolbarWidgets
                updateChartType={updateChartType}
                updateGranularity={updateGranularity}
                position={!isDesktop ? 'bottom' : 'top'}
                isDesktop={isDesktop}
            />
        ),
        [updateChartType, updateGranularity, isDesktop]
    );
    const topWidgets = useCallback(() => <ChartTitle onChange={onSymbolChange} />, [onSymbolChange]);

    if (!symbol) return null;
    const is_connection_opened = !!chart_api?.api;
    return (
        <div
            className={classNames('dashboard__chart-wrapper', {
                'dashboard__chart-wrapper--expanded': is_drawer_open && isDesktop,
                'dashboard__chart-wrapper--modal': is_chart_modal_visible && isDesktop,
                'dashboard__chart-wrapper--safari': isSafari,
            })}
            dir='ltr'
        >
            <SmartChart
                id='dbot'
                barriers={EMPTY_BARRIERS}
                showLastDigitStats={show_digits_stats}
                chartControlsWidgets={null}
                enabledChartFooter={false}
                chartStatusListener={chartStatusListener}
                toolbarWidget={toolbarWidget}
                chartType={chart_type}
                isMobile={isMobile}
                enabledNavigationWidget={isDesktop}
                granularity={granularity}
                requestAPI={requestAPI}
                requestForget={noop}
                requestForgetStream={noop}
                requestSubscribe={requestSubscribe}
                settings={settings}
                symbol={symbol}
                topWidgets={topWidgets}
                isConnectionOpened={is_connection_opened}
                getMarketsOrder={getMarketsOrder}
                isLive
                leftMargin={80}
            />
        </div>
    );
});

export default Chart;
