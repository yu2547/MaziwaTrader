import { initSurvicate } from '../public-path';
import { lazy, Suspense } from 'react';
import React from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import RouteErrorBoundary from '@/components/layout/route-error-boundary';
import LoadingScreen from '@/components/loading-screen/loading-screen';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { StoreProvider } from '@/hooks/useStore';
import CallbackPage from '@/pages/callback';
import Endpoint from '@/pages/endpoint';
import { TAuthData } from '@/types/api-types';
import { initializeI18n, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));
const FreeBots = lazy(() => import('../pages/free-bots'));
const AnalysisTool = lazy(() => import('../pages/analysis-tool'));
const RiskCalculator = lazy(() => import('../pages/risk-calculator'));
const BulkTrader = lazy(() => import('../pages/bulk-trader'));
const ManualTrader = lazy(() => import('../pages/manual-trader'));
const TradingViewPage = lazy(() => import('../pages/trading-view'));
const CopyTrading = lazy(() => import('../pages/copy-trading'));

const { TRANSLATIONS_CDN_URL, R2_PROJECT_NAME, CROWDIN_BRANCH_NAME } = process.env;
// These are only set in Deriv's own CI (see .github/workflows/build-and-deploy-production.yml);
// a fresh Vercel deployment won't have them configured. Without this guard, cdnUrl becomes the
// literal string "undefined/undefined/undefined" and every load fires a doomed fetch to it -
// harmless (i18next falls back to each <Localize> call's own default text) but wasteful.
const i18nInstance =
    TRANSLATIONS_CDN_URL && R2_PROJECT_NAME && CROWDIN_BRANCH_NAME
        ? initializeI18n({ cdnUrl: `${TRANSLATIONS_CDN_URL}/${R2_PROJECT_NAME}/${CROWDIN_BRANCH_NAME}` })
        : initializeI18n({ cdnUrl: '' });

// Uses the same cinematic LoadingScreen as app-root's real-init loader so a
// visitor never sees a plain/generic spinner flash before the branded one -
// this fallback only covers the brief window while route chunks (Layout,
// AppRoot, etc.) are being fetched, not any real init state, so `ready` is
// always false here and `onExited` is a no-op: Suspense itself swaps this
// out for the real children the moment they're available.
const SuspenseWrapper = ({ children }: { children: React.ReactNode }) => {
    return <Suspense fallback={<LoadingScreen ready={false} onExited={() => {}} />}>{children}</Suspense>;
};

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            path='/'
            element={
                // TranslationProvider wraps the Suspense boundary (not just its
                // children) so LoadingScreen - used as the fallback - has the
                // same translation context as everything it's a placeholder for.
                <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                    <SuspenseWrapper>
                        <StoreProvider>
                            <RoutePromptDialog />
                            <CoreStoreProvider>
                                <Layout />
                            </CoreStoreProvider>
                        </StoreProvider>
                    </SuspenseWrapper>
                </TranslationProvider>
            }
        >
            {/* All child routes will be passed as children to Layout.
                Each carries its own errorElement so a page that throws is
                contained to the content area - without one, React Router
                falls back to the '/' boundary, whose element is the entire
                Layout, and the header and navigation disappear along with
                the failing page. */}
            <Route index element={<AppRoot />} errorElement={<RouteErrorBoundary />} />
            <Route path='endpoint' element={<Endpoint />} errorElement={<RouteErrorBoundary />} />
            <Route path='callback' element={<CallbackPage />} errorElement={<RouteErrorBoundary />} />
            <Route path='free-bots' element={<FreeBots />} errorElement={<RouteErrorBoundary />} />
            <Route path='analysis-tool' element={<AnalysisTool />} errorElement={<RouteErrorBoundary />} />
            <Route path='risk-calculator' element={<RiskCalculator />} errorElement={<RouteErrorBoundary />} />
            <Route path='bulk-trader' element={<BulkTrader />} errorElement={<RouteErrorBoundary />} />
            <Route path='manual' element={<ManualTrader />} errorElement={<RouteErrorBoundary />} />
            <Route path='tradingview' element={<TradingViewPage />} errorElement={<RouteErrorBoundary />} />
            <Route path='copy-trading' element={<CopyTrading />} errorElement={<RouteErrorBoundary />} />
        </Route>
    )
);

function App() {
    React.useEffect(() => {
        // Use the invalid token handler hook to automatically retrigger OIDC authentication
        // when an invalid token is detected and the cookie logged state is true

        initSurvicate();
        window?.dataLayer?.push({ event: 'page_load' });
        return () => {
            // Clean up the invalid token handler when the component unmounts
            const survicate_box = document.getElementById('survicate-box');
            if (survicate_box) {
                survicate_box.style.display = 'none';
            }
        };
    }, []);

    React.useEffect(() => {
        const accounts_list = localStorage.getItem('accountsList');
        const client_accounts = localStorage.getItem('clientAccounts');
        const url_params = new URLSearchParams(window.location.search);
        const account_currency = url_params.get('account');
        const validCurrencies = [...fiat_currencies_display_order, ...crypto_currencies_display_order];

        const is_valid_currency = account_currency && validCurrencies.includes(account_currency?.toUpperCase());

        if (!accounts_list || !client_accounts) return;

        try {
            const parsed_accounts = JSON.parse(accounts_list);
            const parsed_client_accounts = JSON.parse(client_accounts) as TAuthData['account_list'];

            const updateLocalStorage = (token: string, loginid: string) => {
                localStorage.setItem('authToken', token);
                localStorage.setItem('active_loginid', loginid);
            };

            // Handle demo account
            if (account_currency?.toUpperCase() === 'DEMO') {
                const demo_account = Object.entries(parsed_accounts).find(([key]) => key.startsWith('VR'));

                if (demo_account) {
                    const [loginid, token] = demo_account;
                    updateLocalStorage(String(token), loginid);
                    return;
                }
            }

            // Handle real account with valid currency
            if (account_currency?.toUpperCase() !== 'DEMO' && is_valid_currency) {
                const real_account = Object.entries(parsed_client_accounts).find(
                    ([loginid, account]) =>
                        !loginid.startsWith('VR') && account.currency.toUpperCase() === account_currency?.toUpperCase()
                );

                if (real_account) {
                    const [loginid, account] = real_account;
                    if ('token' in account) {
                        updateLocalStorage(String(account?.token), loginid);
                    }
                    return;
                }
            }
        } catch (e) {
            console.warn('Error', e); // eslint-disable-line no-console
        }
    }, []);

    return <RouterProvider router={router} />;
}

export default App;
