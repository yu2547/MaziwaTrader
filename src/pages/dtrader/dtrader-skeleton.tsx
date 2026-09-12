import { Loader } from '@deriv-com/ui';
import './dtrader-skeleton.scss';

/**
 * What stands in for the page while its chunk is on its way.
 *
 * It is the page's own frame - the chart's space with Deriv's spinner in it and
 * the ticket's column as blocks - rather than the app's full-screen branded
 * loader, which is what the route used to fall back to: that replaced the
 * header and the navigation as well, so clicking DTrader blanked the whole
 * window to load 55KB of page.
 *
 * Deliberately small and in the main bundle, since it has to be on screen
 * before the chunk it is waiting for arrives.
 */
const DTraderSkeleton = () => (
    <div className='mw-dt-skeleton'>
        <div className='mw-dt-skeleton__stage'>
            <Loader />
        </div>
        <div className='mw-dt-skeleton__ticket' aria-hidden='true'>
            <div className='mw-dt-skeleton__block' />
            <div className='mw-dt-skeleton__block' />
            <div className='mw-dt-skeleton__block' />
            <div className='mw-dt-skeleton__block' />
        </div>
    </div>
);

export default DTraderSkeleton;
