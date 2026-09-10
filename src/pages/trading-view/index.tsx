import { observer } from 'mobx-react-lite';
import TradingViewComponent from '@/components/trading-view-chart/trading-view';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { LegacyThemeDarkIcon, LegacyThemeLightIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
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
 * instead, which is what the navigation points at.
 *
 * The chart is live: its price and its clock advance, measured on localhost
 * and on the deployed site. It opens on a 24h timeframe, where a candle takes
 * a day to close, so it reads as a still picture until the timeframe is
 * changed from its own toolbar - and it remembers that choice. That default
 * belongs to charts.deriv.com, which opens the same way on its own page and
 * ignores an interval passed in the URL.
 */
const TradingViewPage = observer(() => {
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const { localize } = useTranslations();

    return (
        <div className='mw-tradingview'>
            {/*
                The app's own theme switch, not a second one: it calls the same
                useThemeSwitcher the footer control uses, so the page, the
                chart and the rest of the app move together. The chart is
                cross-origin and reloads on the change - see trading-view.tsx.
            */}
            <button
                type='button'
                className='mw-tradingview__theme'
                onClick={toggleTheme}
                aria-label={localize('Change theme')}
                aria-pressed={is_dark_mode_on}
                title={localize('Change theme')}
            >
                {is_dark_mode_on ? <LegacyThemeDarkIcon iconSize='xs' /> : <LegacyThemeLightIcon iconSize='xs' />}
            </button>

            <TradingViewComponent />
        </div>
    );
});

export default TradingViewPage;
