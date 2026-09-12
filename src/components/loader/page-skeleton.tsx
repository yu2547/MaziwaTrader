import { Loader } from '@deriv-com/ui';
import './page-skeleton.scss';

/**
 * What stands in for a page while its chunk is on its way.
 *
 * Every route used to fall back to the app's full-screen branded loader, which
 * is the boundary wrapping the whole shell - so moving between pages blanked
 * the header and the navigation as well, to fetch tens of kilobytes. This fills
 * the content area alone: Deriv's spinner where the page goes, and for the
 * pages that have a panel down the right, that column held as blocks.
 *
 * Deliberately small and in the main bundle, since it has to be on screen
 * before the chunk it is waiting for arrives.
 */
const PageSkeleton = ({ with_panel = false }: { with_panel?: boolean }) => (
    <div className={`mw-page-skeleton${with_panel ? ' mw-page-skeleton--panel' : ''}`}>
        <div className='mw-page-skeleton__stage'>
            <Loader />
        </div>
        {with_panel && (
            <div className='mw-page-skeleton__side' aria-hidden='true'>
                <div className='mw-page-skeleton__block' />
                <div className='mw-page-skeleton__block' />
                <div className='mw-page-skeleton__block' />
                <div className='mw-page-skeleton__block' />
            </div>
        )}
    </div>
);

export default PageSkeleton;
