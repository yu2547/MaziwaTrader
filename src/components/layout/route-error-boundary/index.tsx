import { useEffect, useState } from 'react';
import { useNavigate, useRouteError } from 'react-router-dom';
import { Localize } from '@deriv-com/translations';
import './route-error-boundary.scss';

/**
 * Attached to each child route so a page that throws is contained to the
 * content area instead of taking the shell with it.
 *
 * Without an errorElement on the child, React Router walks up to the nearest
 * boundary - the '/' route, whose element *is* the whole Layout - and replaces
 * header, navigation and content together, leaving no way to navigate out. A
 * single unguarded call in one page could therefore strand the entire app,
 * which is exactly what happened when the Charts cleanup threw on unmount.
 */

/**
 * A tab that was opened before a deploy still holds the old index.html, so
 * navigating to a lazily-loaded page asks for a chunk filename that the new
 * build no longer contains. Nothing is broken - the app is simply out of date -
 * and reloading fetches the current index.html and the chunk names that go
 * with it. Matching on the error message is how this is detectable: webpack
 * throws a plain Error, and the wording differs between webpack and native
 * dynamic import, so all the known phrasings are covered here.
 */
const STALE_BUILD_ERROR =
    /Loading chunk \S+ failed|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/**
 * Reloading on a chunk error is only safe if it cannot repeat. If the reload
 * does not fix it - a chunk genuinely absent from the deployment rather than a
 * stale tab - a second automatic reload would put the app in a refresh loop
 * with no way out, so one attempt per window is all it gets.
 */
const RELOAD_GUARD_KEY = 'mw_stale_build_reload_at';
const RELOAD_GUARD_MS = 30000;

const RouteErrorBoundary = () => {
    const error = useRouteError() as Error | undefined;
    const navigate = useNavigate();
    const is_stale_build = STALE_BUILD_ERROR.test(error?.message ?? '');
    // True once a reload has already been attempted and the page still failed,
    // which means reloading again will not help and the user has to be told.
    const [reload_did_not_help, setReloadDidNotHelp] = useState(false);

    useEffect(() => {
        if (!is_stale_build) return;

        let last_attempt = 0;
        try {
            last_attempt = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
        } catch {
            // Private mode with storage disabled - treat as never attempted.
        }

        if (Date.now() - last_attempt < RELOAD_GUARD_MS) {
            setReloadDidNotHelp(true);
            return;
        }

        try {
            sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
        } catch {
            // If the attempt cannot be recorded, reloading risks a loop.
            setReloadDidNotHelp(true);
            return;
        }

        window.location.reload();
    }, [is_stale_build]);

    // Mid-reload. Showing a crash report here would be wrong - nothing has
    // gone wrong that the user needs to act on, the page is about to return.
    if (is_stale_build && !reload_did_not_help) {
        return (
            <div className='route-error' role='status'>
                <h2 className='route-error__title'>
                    <Localize i18n_default_text='Updating to the latest version...' />
                </h2>
                <p className='route-error__body'>
                    <Localize i18n_default_text='A new version of MaziwaTrader was released. This page is reloading itself.' />
                </p>
            </div>
        );
    }

    if (is_stale_build) {
        return (
            <div className='route-error' role='alert'>
                <h2 className='route-error__title'>
                    <Localize i18n_default_text='This page could not be loaded' />
                </h2>
                <p className='route-error__body'>
                    <Localize i18n_default_text='Part of the app failed to download. A hard refresh (Ctrl+Shift+R) usually clears it. The rest of the app is still working.' />
                </p>
                <button
                    type='button'
                    className='route-error__action'
                    onClick={() => window.location.reload()}
                    data-testid='dt_route_error_reload'
                >
                    <Localize i18n_default_text='Reload' />
                </button>
            </div>
        );
    }

    return (
        <div className='route-error' role='alert'>
            <h2 className='route-error__title'>
                <Localize i18n_default_text='This page ran into a problem' />
            </h2>
            <p className='route-error__body'>
                <Localize i18n_default_text='The rest of the app is still working - use the navigation above to continue.' />
            </p>
            {error?.message && <pre className='route-error__detail'>{error.message}</pre>}
            <button type='button' className='route-error__action' onClick={() => navigate('/')}>
                <Localize i18n_default_text='Back to Dashboard' />
            </button>
        </div>
    );
};

export default RouteErrorBoundary;
