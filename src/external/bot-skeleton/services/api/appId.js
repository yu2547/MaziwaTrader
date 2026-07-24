import { getAppId, getSocketURL } from '@/components/shared';
import { website_name } from '@/utils/site-config';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import { getInitialLanguage } from '@deriv-com/translations';
import APIMiddleware from './api-middleware';

export const generateDerivApiInstance = () => {
    const cleanedServer = getSocketURL().replace(/[^a-zA-Z0-9.]/g, '');
    const cleanedAppId = getAppId()?.replace?.(/[^a-zA-Z0-9]/g, '') ?? getAppId();
    const socket_url = `wss://${cleanedServer}/websockets/v3?app_id=${cleanedAppId}&l=${getInitialLanguage()}&brand=${website_name.toLowerCase()}`;

    // TEMPORARY DEBUG LOGGING - remove once the connection issue is confirmed resolved.
    // eslint-disable-next-line no-console
    console.log('[WS DEBUG] connecting to:', socket_url);

    const deriv_socket = new WebSocket(socket_url);

    let first_message_logged = false;
    deriv_socket.addEventListener('open', () => {
        // eslint-disable-next-line no-console
        console.log('[WS DEBUG] open event fired for:', socket_url);
    });
    deriv_socket.addEventListener('close', event => {
        // eslint-disable-next-line no-console
        console.log('[WS DEBUG] close event:', {
            url: socket_url,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
        });
    });
    deriv_socket.addEventListener('error', event => {
        // eslint-disable-next-line no-console
        console.log('[WS DEBUG] error event for:', socket_url, event);
    });
    deriv_socket.addEventListener('message', event => {
        if (first_message_logged) return;
        first_message_logged = true;
        // eslint-disable-next-line no-console
        console.log('[WS DEBUG] first message received:', event.data);
    });

    const deriv_api = new DerivAPIBasic({
        connection: deriv_socket,
        middleware: new APIMiddleware({}),
    });
    return deriv_api;
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
