import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/hooks/useStore';
import { completeDerivLogin, DerivOAuthError, readCallbackParams } from '@/utils/auth/deriv-oauth';
import { listOptionsAccounts } from '@/utils/options-trading/options-trading-api';
import { Button } from '@deriv-com/ui';

/**
 * OAuth callback handler.
 *
 * On success: stores the access token and Options account list in
 * oauth_session (src/stores/oauth-session-store.ts), then redirects into the
 * dashboard. This is a separate, additive authenticated-state model - it does
 * not touch AuthWrapper.tsx, legacy tokens, or the classic WebSocket layer.
 * See app-root.tsx's is_landing_page check for where this session is
 * recognized as "logged in", and dashboard-hero.tsx for where its account
 * data is displayed.
 */

type TStatus = 'processing' | 'error';

/**
 * Both steps below are plain fetches with no timeout of their own, so a
 * request that never settles leaves this page on "Completing sign-in..."
 * forever - a blank screen with no error and no way forward. Neither .then
 * nor .catch ever runs, so nothing here can react to it.
 *
 * Racing them against a clock guarantees the page always ends somewhere: the
 * dashboard, or a visible error explaining which step gave up.
 */
const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not respond within ${Math.round(ms / 1000)}s.`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
};

const TOKEN_EXCHANGE_TIMEOUT_MS = 20000;
const ACCOUNTS_TIMEOUT_MS = 15000;

const ERROR_TITLES: Record<string, string> = {
    oauth_server_error: 'Deriv could not complete sign-in',
    redirect_uri_mismatch: 'Redirect URL mismatch',
    invalid_state: 'Security check failed',
    missing_code: 'No authorization code received',
    missing_verifier: 'Sign-in could not be completed in this tab',
    network_failure: 'Could not reach Deriv',
    token_exchange_failed: 'Token exchange failed',
};

const CallbackPage = () => {
    const [status, setStatus] = useState<TStatus>('processing');
    const [error, setError] = useState<{ title: string; message: string; detail?: string } | null>(null);
    const has_run = useRef(false);
    const navigate = useNavigate();
    // RootStore initializes itself inside its own effect (see useStore.tsx's
    // StoreProvider), so this is null on the very first render - the effect
    // below waits for it rather than destructuring immediately.
    const store = useStore();

    useEffect(() => {
        if (has_run.current || !store) return;
        has_run.current = true;

        withTimeout(completeDerivLogin(readCallbackParams()), TOKEN_EXCHANGE_TIMEOUT_MS, 'Deriv sign-in')
            .then(async token_response => {
                store.oauth_session.setSession(token_response.access_token, token_response.expires_in);

                try {
                    const accounts = await withTimeout(
                        listOptionsAccounts(token_response.access_token),
                        ACCOUNTS_TIMEOUT_MS,
                        'The account list'
                    );
                    store.oauth_session.setAccounts(accounts);
                } catch (accounts_error) {
                    // Non-fatal: the session itself is valid even if the accounts
                    // list couldn't be fetched (e.g. a transient network error) -
                    // the dashboard handles an empty account list gracefully, so
                    // there's no reason to strand the user on this page over it.
                    // eslint-disable-next-line no-console
                    console.error('[MW-AUTH] failed to fetch Options accounts after login', accounts_error);
                }

                navigate('/', { replace: true });
            })
            .catch(err => {
                if (err instanceof DerivOAuthError) {
                    setError({
                        title: ERROR_TITLES[err.kind] ?? 'Sign-in failed',
                        message: err.message,
                        detail: err.detail,
                    });
                } else {
                    // eslint-disable-next-line no-console
                    console.error('[MW-AUTH] unexpected callback failure', err);
                    setError({
                        title: 'Sign-in failed',
                        message: err instanceof Error ? err.message : 'An unexpected error occurred.',
                    });
                }
                setStatus('error');
            });
    }, [store, navigate]);

    if (status === 'error' && error) {
        return (
            <div className='callback-page'>
                <h2>{error.title}</h2>
                <p>{error.message}</p>
                {error.detail && <p className='callback-page__detail'>{error.detail}</p>}
                <Button
                    className='callback-return-button'
                    onClick={() => {
                        window.location.href = '/';
                    }}
                >
                    {'Return to MaziwaTrader'}
                </Button>
            </div>
        );
    }

    return (
        <div className='callback-page'>
            <p>Completing sign-in…</p>
        </div>
    );
};

export default CallbackPage;
