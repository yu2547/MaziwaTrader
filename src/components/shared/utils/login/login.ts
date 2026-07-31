import { beginDerivLogin } from '@/utils/auth/deriv-oauth';
import { DERIV_REFERRAL_URL } from '@/utils/site-config';
import { isStorageSupported } from '../storage/storage';

export const redirectToLogin = (is_logged_in: boolean, redirect_delay = 0) => {
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
