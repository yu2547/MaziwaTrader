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

    useEffect(() => {
        if (!symbol) updateSymbol();
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
