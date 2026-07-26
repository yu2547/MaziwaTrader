import { useCallback, useState } from 'react';
import { useEffect } from 'react';
import Cookies from 'js-cookie';
import RootStore from '@/stores/root-store';
import { handleOidcAuthFailure } from '@/utils/auth-utils';
import { Analytics } from '@deriv-com/analytics';
import { OAuth2Logout, requestOidcAuthentication } from '@deriv-com/auth-client';

/**
 * Provides an object with properties: `oAuthLogout`, `retriggerOAuth2Login`, and `isSingleLoggingIn`.
 *
 * `oAuthLogout` is a function that logs out the user of the OAuth2-enabled app.
 *
 * `retriggerOAuth2Login` is a function that retriggers the OAuth2 login flow to get a new token.
 *
 * `isSingleLoggingIn` is a boolean that indicates whether the user is currently logging in.
 *
 * The `handleLogout` argument is an optional function that will be called after logging out the user.
 * If `handleLogout` is not provided, the function will resolve immediately.
 *
 * @param {{ handleLogout?: () => Promise<void> }} [options] - An object with an optional `handleLogout` property.
 * @returns {{ oAuthLogout: () => Promise<void>; retriggerOAuth2Login: () => Promise<void>; isSingleLoggingIn: boolean }}
 */
export const useOauth2 = ({
    handleLogout,
    client,
}: {
    handleLogout?: () => Promise<void>;
    client?: RootStore['client'];
} = {}) => {
    const [isSingleLoggingIn, setIsSingleLoggingIn] = useState(false);
    const accountsList = JSON.parse(localStorage.getItem('accountsList') ?? '{}');
    const isClientAccountsPopulated = Object.keys(accountsList).length > 0;
    const isSilentLoginExcluded =
        window.location.pathname.includes('callback') || window.location.pathname.includes('endpoint');

    const loggedState = Cookies.get('logged_state');

    useEffect(() => {
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            if (event?.reason?.error?.code === 'InvalidToken') {
                setIsSingleLoggingIn(false);
            }
        };
        // Every component calling useOauth2() (there are several: CoreStoreProvider,
        // the account switcher, main.tsx) previously added its own 'unhandledrejection'
        // listener here with no cleanup - each mount left another one behind on
        // `window` for the life of the page. Named handler + cleanup so unmounting
        // actually removes it.
        window.addEventListener('unhandledrejection', handleUnhandledRejection);
        return () => {
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        };
    }, []);

    useEffect(() => {
        const willEventuallySSO = loggedState === 'true' && !isClientAccountsPopulated;
        const willEventuallySLO = loggedState === 'false' && isClientAccountsPopulated;

        if (!isSilentLoginExcluded && (willEventuallySSO || willEventuallySLO)) {
            setIsSingleLoggingIn(true);
        } else {
            setIsSingleLoggingIn(false);
        }
    }, [isClientAccountsPopulated, loggedState, isSilentLoginExcluded]);

    // useCallback so consumers (e.g. CoreStoreProvider) that depend on this
    // function reference in their own effects/callbacks don't see a "new" function
    // every render - previously a fresh reference every time meant any effect
    // depending on it (directly or transitively) re-ran on every render of
    // whichever component called useOauth2(), including tearing down and
    // recreating unrelated WebSocket message subscriptions unnecessarily.
    const logoutHandler = useCallback(async () => {
        client?.setIsLoggingOut(true);
        try {
            await OAuth2Logout({
                redirectCallbackUri: `${window.location.origin}/callback`,
                WSLogoutAndRedirect: handleLogout ?? (() => Promise.resolve()),
                postLogoutRedirectUri: window.location.origin,
            }).catch(err => {
                // eslint-disable-next-line no-console
                console.error(err);
            });
            await client?.logout().catch(err => {
                // eslint-disable-next-line no-console
                console.error('Error during TMB logout:', err);
            });

            Analytics.reset();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error);
        }
    }, [client, handleLogout]);
    const retriggerOAuth2Login = useCallback(async () => {
        try {
            await requestOidcAuthentication({
                redirectCallbackUri: `${window.location.origin}/callback`,
                postLogoutRedirectUri: window.location.origin,
            }).catch(err => {
                handleOidcAuthFailure(err);
            });
        } catch (error) {
            handleOidcAuthFailure(error);
        }
    }, []);

    return { oAuthLogout: logoutHandler, retriggerOAuth2Login, isSingleLoggingIn };
};
