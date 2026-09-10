import { observer } from 'mobx-react-lite';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';

/**
 * charts.deriv.com in an iframe.
 *
 * `theme` is passed through so the chart matches the rest of the app rather
 * than sitting as a light rectangle inside a dark page. Verified against the
 * live URL: theme=dark renders dark and theme=light renders light, so the
 * parameter is honoured rather than ignored.
 *
 * Changing it changes the src, which reloads the frame - the chart is
 * cross-origin, so there is no way to retheme it in place. That reload is why
 * this follows the app's theme instead of offering a second switch of its own.
 */
const TradingViewComponent = observer(() => {
    const { is_dark_mode_on } = useThemeSwitcher();
    const theme = is_dark_mode_on ? 'dark' : 'light';

    return (
        <iframe
            id='trading-view-iframe'
            title='TradingView chart'
            // No hardcoded white: it showed through as a white flash on load
            // and as a white border around a dark chart.
            style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
            src={`https://charts.deriv.com/deriv?hide-signup=true&theme=${theme}`}
        />
    );
});

export default TradingViewComponent;
