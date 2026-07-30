import { beginDerivLogin } from '@/utils/auth/deriv-oauth';
import { DERIV_REFERRAL_URL } from '@/utils/site-config';
import { isStorageSupported } from '../storage/storage';

// language is no longer used to build the URL (beginDerivLogin doesn't take
// one - Deriv's login page handles locale itself), but stays in the
// signature since callers still pass it positionally.
export const redirectToLogin = (
    is_logged_in: boolean,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    language: string,
    redirect_delay = 0
) => {
    if (!is_logged_in && isStorageSupported(sessionStorage)) {
        setTimeout(() => {
            beginDerivLogin().catch(err => {
                // eslint-disable-next-line no-console
                console.error('Failed to start Deriv login:', err);
            });
        }, redirect_delay);
    }
};

export const redirectToSignUp = () => {
    window.open(DERIV_REFERRAL_URL);
};
