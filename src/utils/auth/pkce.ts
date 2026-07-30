/**
 * PKCE (RFC 7636) helpers for Deriv's documented Authorization Code + PKCE
 * flow (developers.deriv.com/docs/intro/oauth). Mirrors the sample code
 * shown on that page.
 */

const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export const generateCodeVerifier = (): string => {
    const array = crypto.getRandomValues(new Uint8Array(64));
    return Array.from(array)
        .map(v => PKCE_CHARSET[v % PKCE_CHARSET.length])
        .join('');
};

export const generateCodeChallenge = async (code_verifier: string): Promise<string> => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code_verifier));
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
};

export const generateState = (): string => {
    const array = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(array).reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
};
