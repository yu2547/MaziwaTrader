import TradingViewComponent from '@/components/trading-view-chart/trading-view';
import LiveStrip from './live-strip';
import './trading-view-page.scss';

/**
 * The chart as a page, filling the content area.
 *
 * It reached the app before this as a 526x595 draggable box floating over the
 * Bot Builder, which is a reasonable thing to have beside a workspace and a
 * poor way to read a chart: a candlestick series in a window that size shows a
 * fraction of the history and none of the detail.
 *
 * The draggable one is untouched - the Bot Builder toolbar still opens it, in
 * place, over the workspace. This is the same chart given the whole area
 * instead, which is what the navigation now points at.
 *
 * The strip above it carries the live spot price of every volatility market.
 * The chart is a cross-origin iframe, so nothing here can read its symbol or
 * its timeframe - and it opens on 24h, where a candle takes a day to close.
 * The strip is what moves while you watch.
 */
const TradingViewPage = () => (
    <div className='mw-tradingview'>
        <LiveStrip />
        <TradingViewComponent />
    </div>
);

export default TradingViewPage;
