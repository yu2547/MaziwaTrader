import TradingViewComponent from '@/components/trading-view-chart/trading-view';
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
 */
const TradingViewPage = () => (
    <div className='mw-tradingview'>
        <TradingViewComponent />
    </div>
);

export default TradingViewPage;
