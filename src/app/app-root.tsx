import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import LoadingScreen from '@/components/loading-screen/loading-screen';
import { api_base } from '@/external/bot-skeleton';
import { V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import LandingPage from '@/pages/landing/landing-page';
import { restoreStoredSession } from '@/utils/auth/deriv-oauth';
import { listOptionsAccounts } from '@/utils/options-trading/options-trading-api';
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
    const api_base_initialized = useRef(false);
    const [is_api_initialized, setIsApiInitialized] = useState(false);
    const [is_tmb_check_complete, setIsTmbCheckComplete] = useState(false);
    const [, setIsTmbEnabled] = useState(false);
    const [show_loading_screen, setShowLoadingScreen] = useState(true);
    const [is_oauth_restore_complete, setIsOauthRestoreComplete] = useState(false);
    const oauth_restore_started = useRef(false);
    const { isTmbEnabled } = useTMB();

    // oauth_session (src/stores/oauth-session-store.ts) is in-memory only and
    // is rebuilt empty on every load, but completeDerivLogin() already
    // persists the access token to sessionStorage - without reading it back
    // here, a page refresh silently logged an OAuth-only session out (no
    // legacy token to fall back on, so is_landing_page would go true).
    useEffect(() => {
        if (oauth_restore_started.current || !store) return;
        oauth_restore_started.current = true;

        const restore = async () => {
            const restored = restoreStoredSession();
            if (restored && !store.oauth_session.is_authenticated) {
                store.oauth_session.setSession(restored.access_token, restored.expires_in);
                try {
                    const accounts = await listOptionsAccounts(restored.access_token);
                    store.oauth_session.setAccounts(accounts);
                } catch (error) {
                    // Non-fatal: the session itself is still valid even if the
                    // accounts list couldn't be refreshed right now.
                    console.error('[MW-AUTH] failed to refresh Options accounts on restore:', error);
                }
            }
            setIsOauthRestoreComplete(true);
        };

        restore();
    }, [store]);

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

    // Initialize API when TMB check is complete with timeout fallback
    useEffect(() => {
        if (!is_tmb_check_complete) {
            return; // Wait until TMB check is complete
        }

        const timeoutId = setTimeout(() => {
            if (!is_api_initialized) {
                setIsApiInitialized(true);
            }
        }, 2000);

        const initializeApi = async () => {
            if (!api_base_initialized.current) {
                try {
                    await api_base.init();
                    api_base_initialized.current = true;
                } catch (error) {
                    console.error('API initialization failed:', error);
                    api_base_initialized.current = false;
                } finally {
                    setIsApiInitialized(true);
                    clearTimeout(timeoutId); // Clear timeout if API init completes
                }
            }
        };

        initializeApi();
        return () => clearTimeout(timeoutId);
    }, [is_tmb_check_complete]);

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
