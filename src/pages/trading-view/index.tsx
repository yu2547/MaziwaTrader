import { lazy, Suspense, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import TradingViewComponent from '@/components/trading-view-chart/trading-view';
import chart_api from '@/external/bot-skeleton/services/api/chart-api';
import { useTranslations } from '@deriv-com/translations';
import LiveStrip from './live-strip';
import './trading-view-page.scss';

// The app's own chart - SmartCharts on the live tick stream. Lazy for the same
// reason the Charts tab loads it lazily: it is a large chunk, and a visit that
// stays on TradingView never needs it.
const ChartWrapper = lazy(() => import('../chart/chart-wrapper'));

type TView = 'live' | 'tradingview';

/** How often to look for the chart connection while it is still coming up. */
const READY_POLL_MS = 500;

/**
 * The chart as a page, filling the content area, with two of them to choose
 * from.
 *
 * "Live ticks" is the app's own SmartCharts on the live tick stream, and it is
 * the default because it moves the moment the page opens.
 *
 * "TradingView" is the charts.deriv.com embed. It is live too - its price and
 * its clock advance, measured - but it opens on a 24h timeframe where a candle
 * takes a day to close, so it reads as a still picture. That default belongs
 * to charts.deriv.com: the official page opens the same way, it ignores an
 * interval passed in the URL, and its saved state lives on its own origin
 * where this page cannot reach it. Switched to 1m from its own toolbar it
 * streams like anything else, and it remembers that choice.
 *
 * SmartCharts needs the chart connection, and chart-api.js disables chart data
 * outright on a session where that connection cannot be established rather
 * than retrying an endpoint that will not answer. On such a session the live
 * chart renders nothing at all - so it is offered only once the connection is
 * actually there, and the embed, which works either way, carries the page in
 * the meantime. A page that is never blank is worth more than a default that
 * is right most of the time.
 *
 * The draggable TradingView modal is untouched. The Bot Builder toolbar still
 * opens it, in place, over the workspace.
 */
const TradingViewPage = observer(() => {
    const { localize } = useTranslations();
    const [view, setView] = useState<TView>('live');
    const [live_ready, setLiveReady] = useState(Boolean(chart_api.api));

    // chart_api is a module singleton brought up by api_base, not by this page,
    // and it exposes nothing observable - so this watches for it rather than
    // assuming it is there on mount, and stops the moment it arrives.
    useEffect(() => {
        if (live_ready) return undefined;
        const timer = setInterval(() => {
            if (chart_api.api) setLiveReady(true);
        }, READY_POLL_MS);
        return () => clearInterval(timer);
    }, [live_ready]);

    const showing: TView = view === 'live' && !live_ready ? 'tradingview' : view;

    return (
        <div className='mw-tradingview'>
            {/* Above both charts, because it is true of both: the live spot of
                every volatility market, off the feed the app already holds. */}
            <LiveStrip />

            <div className='mw-tradingview__switch'>
                <button
                    type='button'
                    className={`mw-tradingview__tab${showing === 'live' ? ' mw-tradingview__tab--on' : ''}`}
                    aria-pressed={showing === 'live'}
                    disabled={!live_ready}
                    onClick={() => setView('live')}
                >
                    {localize('Live ticks')}
                </button>
                <button
                    type='button'
                    className={`mw-tradingview__tab${showing === 'tradingview' ? ' mw-tradingview__tab--on' : ''}`}
                    aria-pressed={showing === 'tradingview'}
                    onClick={() => setView('tradingview')}
                >
                    {localize('TradingView')}
                </button>
                {!live_ready && (
                    <span className='mw-tradingview__hint'>
                        {localize('Live ticks need the chart connection - log in and it appears here.')}
                    </span>
                )}
            </div>

            <div className='mw-tradingview__chart'>
                {showing === 'live' ? (
                    <>
                        {/* Behind the chart rather than instead of it:
                            SmartCharts renders nothing until it has a symbol,
                            and this is what occupies the space until it does -
                            covered the moment the chart paints. */}
                        <p className='mw-tradingview__loading'>{localize('Starting the live chart...')}</p>
                        <Suspense fallback={null}>
                            <ChartWrapper show_digits_stats={false} />
                        </Suspense>
                    </>
                ) : (
                    <TradingViewComponent />
                )}
            </div>
        </div>
    );
});

export default TradingViewPage;
