import { useEffect, useRef, useState } from 'react';
import { crypto_currencies_display_order, fiat_currencies_display_order } from '@/components/shared';
import { generateDerivApiInstance } from '@/external/bot-skeleton/services/api/appId';
import { completeDerivLogin, DerivOAuthStateMismatchError } from '@/utils/auth/deriv-oauth';
import { Button } from '@deriv-com/ui';

/**
 * Gets the selected currency or falls back to appropriate defaults
 */
const getSelectedCurrency = (loginid: string): string => {
    const getQueryParams = new URLSearchParams(window.location.search);
    const currency = getQueryParams.get('account') || sessionStorage.getItem('query_param_currency') || '';

    const validCurrencies = [...fiat_currencies_display_order, ...crypto_currencies_display_order];
    if (loginid?.startsWith('VR') || currency === 'demo') return 'demo';
    if (currency && validCurrencies.includes(currency.toUpperCase())) return currency;
    return 'USD';
};

type TCallbackStatus = 'processing' | 'error';

const CallbackPage = () => {
    const [status, setStatus] = useState<TCallbackStatus>('processing');
    const [error_message, setErrorMessage] = useState('');
    const has_run = useRef(false);

    useEffect(() => {
        if (has_run.current) return;
        has_run.current = true;

        const run = async () => {
            const query_params = new URLSearchParams(window.location.search);
            const oauth_error = query_params.get('error');

            if (oauth_error) {
                setErrorMessage(query_params.get('error_description') || oauth_error);
                setStatus('error');
                return;
            }

            try {
                const { access_token } = await completeDerivLogin({
                    code: query_params.get('code'),
                    state: query_params.get('state'),
                });

                const api = await generateDerivApiInstance();
                if (!api) {
                    throw new Error('Could not open a connection to authorize the account.');
                }

                const { authorize, error } = await api.authorize(access_token);
                api.disconnect();

                if (error || !authorize) {
                    throw new Error(error?.message || 'Deriv rejected the access token during authorize.');
                }

                const loginid = authorize.loginid;
                localStorage.setItem('authToken', access_token);
                localStorage.setItem('active_loginid', loginid);
                localStorage.setItem('accountsList', JSON.stringify({ [loginid]: access_token }));
                localStorage.setItem(
                    'clientAccounts',
                    JSON.stringify({ [loginid]: { loginid, token: access_token, currency: authorize.currency } })
                );

                const selected_currency = getSelectedCurrency(loginid);
                window.location.replace(`${window.location.origin}/?account=${selected_currency}`);
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error('Deriv OAuth callback failed:', err);
                setErrorMessage(
                    err instanceof DerivOAuthStateMismatchError
                        ? err.message
                        : err instanceof Error
                          ? err.message
                          : 'Something went wrong completing sign-in.'
                );
                setStatus('error');
            }
        };

        run();
    }, []);

    if (status === 'error') {
        return (
            <div className='callback-error'>
                <p>{error_message}</p>
                <Button
                    className='callback-return-button'
                    onClick={() => {
                        window.location.href = '/';
                    }}
                >
                    {'Return to Bot'}
                </Button>
            </div>
        );
    }

    return null;
};

export default CallbackPage;
