import { getAppId, getSocketURL } from '@/components/shared';
import { website_name } from '@/utils/site-config';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import { getInitialLanguage } from '@deriv-com/translations';
import APIMiddleware from './api-middleware';

export const generateDerivApiInstance = () => {
    const cleanedServer = getSocketURL().replace(/[^a-zA-Z0-9.]/g, '');
    const rawAppId = getAppId();
    const cleanedAppId = rawAppId?.replace?.(/[^a-zA-Z0-9]/g, '') ?? rawAppId;
    const socket_url = `wss://${cleanedServer}/websockets/v3?app_id=${cleanedAppId}&l=${getInitialLanguage()}&brand=${website_name.toLowerCase()}`;

    const deriv_socket = new WebSocket(socket_url);

    return new DerivAPIBasic({
        connection: deriv_socket,
        middleware: new APIMiddleware({}),
    });
};

// OTP counterpart of generateDerivApiInstance() - same DerivAPIBasic +
// APIMiddleware wrapping, but around a pre-built, already-OTP-authenticated
// WebSocket URL (from requestOptionsOtp in options-trading-api.ts) instead of
// the classic app_id-based endpoint. Kept in this untyped .js file rather
// than a .ts one for the same reason generateDerivApiInstance() already is:
// @deriv/deriv-api ships no type declarations, and TypeScript's "bundler"
// module resolution resolves it to a real on-disk file (not a missing one),
// so an ambient `declare module` shim for it is never actually consulted -
// only the allowJs (uncheckJs) boundary a .js file gives it actually avoids
// the TS7016 error. otp-connection.ts (a .ts file) calls this instead of
// constructing DerivAPIBasic itself.
export const generateOtpApiInstance = websocket_url => {
    const deriv_socket = new WebSocket(websocket_url);

    return new DerivAPIBasic({
        connection: deriv_socket,
        middleware: new APIMiddleware({}),
    });
};

export const getLoginId = () => {
    const login_id = localStorage.getItem('active_loginid');
    if (login_id && login_id !== 'null') return login_id;
    return null;
};

export const V2GetActiveToken = () => {
    const token = localStorage.getItem('authToken');
    if (token && token !== 'null') return token;
    return null;
};

export const V2GetActiveClientId = () => {
    const token = V2GetActiveToken();

    if (!token) return null;
    const account_list = JSON.parse(localStorage.getItem('accountsList'));
    if (account_list && account_list !== 'null') {
        const active_clientId = Object.keys(account_list).find(key => account_list[key] === token);
        return active_clientId;
    }
    return null;
};

export const getToken = () => {
    const active_loginid = getLoginId();
    const client_accounts = JSON.parse(localStorage.getItem('accountsList')) ?? undefined;
    const active_account = (client_accounts && client_accounts[active_loginid]) || {};
    return {
        token: active_account ?? undefined,
        account_id: active_loginid ?? undefined,
    };
};
