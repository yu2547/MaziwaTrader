/**
 * Utility functions for authentication-related operations
 */
import Cookies from 'js-cookie';

/**
 * Single source of truth for "forget this browser's Deriv session" - every logout
 * path (client-store.ts, useTMB.ts, this file's own handleOidcAuthFailure) should
 * call this rather than removing keys inline, so the set of keys cleared can't
 * drift out of sync between them again. Covers everything api-base.ts/
 * google-drive-store.ts write as part of an authenticated session, including the
 * two that were previously missed by every call site (client_account_details,
 * google_access_token*) - see the Phase 2 token security review.
 */
export const clearAuthData = (is_reload: boolean = true): void => {
    localStorage.removeItem('accountsList');
    localStorage.removeItem('clientAccounts');
    localStorage.removeItem('authToken');
    localStorage.removeItem('active_loginid');
    localStorage.removeItem('client.country');
    localStorage.removeItem('client_account_details');
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_access_token_expiry');
    sessionStorage.removeItem('query_param_currency');
    if (is_reload) {
        location.reload();
    }
};

/**
 * Handles OIDC authentication failure by clearing auth data and showing logged out view
 * @param error - The error that occurred during OIDC authentication
 */
export const handleOidcAuthFailure = (error: any): void => {
    // Log the error
    console.error('OIDC authentication failed:', error);

    // Clear auth data (no reload yet - this function does its own reload below,
    // after also updating the logged_state cookie).
    clearAuthData(false);

    // Set logged_state cookie to false
    Cookies.set('logged_state', 'false', {
        domain: window.location.hostname.split('.').slice(-2).join('.'),
        expires: 30,
        path: '/',
        secure: true,
    });

    // Reload the page to show the logged out view
    window.location.reload();
};
