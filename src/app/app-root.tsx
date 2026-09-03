import { lazy, Suspense, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import LoadingScreen from '@/components/loading-screen/loading-screen';
import { V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import useAppBootstrap from '@/hooks/useAppBootstrap';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import LandingPage from '@/pages/landing/landing-page';
import { public_market_feed } from '@/utils/market-data/public-market-feed';
import { localize } from '@deriv-com/translations';
import './app-root.scss';

const AppContent = lazy(() => import('./app-content'));

const ErrorComponentWrapper = observer(() => {
    const { common } = useStore();

    if (!common.error) return null;

    return (
        <ErrorComponent
            header={common.error?.header}
            message={common.error?.message}
            redirect_label={common.error?.redirect_label}
            redirectOnClick={common.error?.redirectOnClick}
            should_clear_error_on_click={common.error?.should_clear_error_on_click}
            setError={common.setError}
            redirect_to={common.error?.redirect_to}
            should_redirect={common.error?.should_redirect}
        />
    );
});

const AppRoot = () => {
    const store = useStore();
    // Restoring the OAuth session and opening the trading connection are the
    // shell's job now (hooks/useAppBootstrap.ts), not this route's - they have
    // to happen on /manual and every other route too, and this page only needs
    // to know when they are done. The work runs once wherever it is asked for
    // first.
    const { is_api_initialized, is_oauth_restore_complete } = useAppBootstrap();
    // Write-only now: nothing gates on the TMB check finishing since API init
    // no longer waits for it, and is_ready never included it. Kept as state so
    // the effect below still records completion in one place if something needs
    // to read it again.
    const [, setIsTmbCheckComplete] = useState(false);
    const [, setIsTmbEnabled] = useState(false);
    const [show_loading_screen, setShowLoadingScreen] = useState(true);
    const { isTmbEnabled } = useTMB();

    // Public market data (public-market-feed.ts) needs no auth and is
    // independent of the classic socket the bootstrap opens - pre-warm the
    // connection here so it's already open by the time the dashboard's own
    // widgets mount. acquire()/release() are reference-counted (see
    // usePublicMarketFeed), so this doesn't tear down the connection out
    // from under standalone routes like Bulk Trader that hold their own ref.
    useEffect(() => {
        public_market_feed.acquire();
        return () => public_market_feed.release();
    }, []);

    // Effect to check TMB status - independent of API initialization
    useEffect(() => {
        const checkTmbStatus = async () => {
            try {
                const tmb_status = await isTmbEnabled();
                const final_status = tmb_status || window.is_tmb_enabled === true;

                setIsTmbEnabled(final_status);

                setIsTmbCheckComplete(true);
            } catch (error) {
                console.error('TMB check failed:', error);
                setIsTmbCheckComplete(true);
            }
        };

        checkTmbStatus();
    }, []);

    // The destination (landing page or dashboard) mounts underneath as soon as
    // the real init this file already tracks (TMB check, API init) is done -
    // LoadingScreen sits on top the whole time and fades itself out once its
    // own presentation finishes AND the destination is actually ready, so
    // there's never a blank frame or a flash of unready content.
    const is_ready = !!store && is_api_initialized && is_oauth_restore_complete;
    // Logged in via either path counts: the legacy classic-WS token (V2GetActiveToken)
    // or the new OAuth + Options API session (oauth_session.is_authenticated) - neither
    // implies the other, and app-content.jsx/dashboard-hero.tsx handle each on its own
    // terms rather than one faking the other's data.
    const is_landing_page = !V2GetActiveToken() && !store?.oauth_session.is_authenticated;

    return (
        <>
            {is_ready &&
                (is_landing_page ? (
                    <LandingPage />
                ) : (
                    <Suspense fallback={<ChunkLoader message={localize('Loading...')} />}>
                        <ErrorBoundary root_store={store}>
                            <ErrorComponentWrapper />
                            <AppContent />
                        </ErrorBoundary>
                    </Suspense>
                ))}
            {show_loading_screen && <LoadingScreen ready={is_ready} onExited={() => setShowLoadingScreen(false)} />}
        </>
    );
};

export default AppRoot;
