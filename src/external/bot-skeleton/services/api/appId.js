import { getAppId, getSocketURL } from '@/components/shared';
import { website_name } from '@/utils/site-config';
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';
import { getInitialLanguage } from '@deriv-com/translations';
import APIMiddleware from './api-middleware';

// TEMPORARY DEBUG INSTRUMENTATION - remove once the connection issue is confirmed resolved.
// Tracks every WebSocket instance this app creates (module-level, survives across calls)
// so we can prove from the console whether more than one is ever live at once, and trace
// exactly what closes each one.
const maskAppId = id => {
    if (!id || id.length <= 8) return id;
    return `${id.slice(0, 4)}${'*'.repeat(id.length - 8)}${id.slice(-4)}`;
};

const captureEnvironment = () => ({
    hostname: window.location.hostname,
    is_localhost: /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname),
    href: window.location.href,
    user_agent: navigator.userAgent,
    timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezone_offset_minutes: new Date().getTimezoneOffset(),
});

const timestampWithTz = () => {
    const now = new Date();
    const offset_min = -now.getTimezoneOffset();
    const sign = offset_min >= 0 ? '+' : '-';
    const pad = n => String(Math.abs(n)).padStart(2, '0');
    const offset_str = `${sign}${pad(Math.trunc(offset_min / 60))}:${pad(offset_min % 60)}`;
    return { utc: now.toISOString(), local: now.toString(), offset: offset_str };
};

// Generates a plain-text diagnostic report suitable for pasting into a support ticket.
// Call window.__ws_debug__.generateDiagnosticReport() from the browser console.
const generateDiagnosticReport = () => {
    const registry = window.__ws_debug__;
    const env = registry.environment;
    const lines = [];
    lines.push('=== MaziwaTrader WebSocket Connection Diagnostic Report ===');
    lines.push(`Generated: ${new Date().toString()}`);
    lines.push('');
    lines.push('-- Environment --');
    lines.push(`Page: ${env.href}`);
    lines.push(`Host: ${env.hostname} (${env.is_localhost ? 'localhost' : 'production domain'})`);
    lines.push(`Browser User-Agent: ${env.user_agent}`);
    lines.push(`Timezone: ${env.timezone_name} (UTC offset ${env.timezone_offset_minutes * -1} min)`);
    lines.push('');
    lines.push(`-- WebSocket attempts (${registry.instances.length} total) --`);
    registry.instances.forEach(i => {
        lines.push(
            [
                `#${i.instance_id}`,
                `url=${i.socket_url.replace(/app_id=[^&]+/, `app_id=${maskAppId(i.app_id || '')}`)}`,
                `created=${i.created_local || i.created_at}`,
                `opened=${i.opened_at ? 'YES at ' + i.opened_at : 'NO'}`,
                `first_message=${i.first_message_at ? 'YES' : 'NO'}`,
                `error=${i.had_error ? 'YES' : 'NO'}`,
                `close_code=${i.close_code ?? 'n/a'}`,
                `close_reason=${i.close_reason || '(none given)'}`,
                `state=${i.state}`,
            ].join(' | ')
        );
    });
    const opened_count = registry.instances.filter(i => i.opened_at).length;
    lines.push('');
    lines.push('-- Summary --');
    lines.push(`Total connection attempts: ${registry.instances.length}`);
    lines.push(`Successfully opened: ${opened_count}`);
    lines.push(`Failed to open: ${registry.instances.length - opened_count}`);
    const report = lines.join('\n');
    // eslint-disable-next-line no-console
    console.log(report);
    return report;
};

if (typeof window !== 'undefined' && !window.__ws_debug__) {
    window.__ws_debug__ = {
        instances: [],
        count: 0,
        environment: captureEnvironment(),
        generateDiagnosticReport,
    };
}

export const generateDerivApiInstance = () => {
    const cleanedServer = getSocketURL().replace(/[^a-zA-Z0-9.]/g, '');
    const rawAppId = getAppId();
    const cleanedAppId = rawAppId?.replace?.(/[^a-zA-Z0-9]/g, '') ?? rawAppId;
    const socket_url = `wss://${cleanedServer}/websockets/v3?app_id=${cleanedAppId}&l=${getInitialLanguage()}&brand=${website_name.toLowerCase()}`;

    const registry = typeof window !== 'undefined' ? window.__ws_debug__ : null;
    const instance_id = registry ? ++registry.count : 0;
    const created_ts = timestampWithTz();
    const created_at = created_ts.utc;
    const create_stack = new Error('created here').stack;

    const live_count = registry ? registry.instances.filter(i => i.state === 'CONNECTING' || i.state === 'OPEN').length : 0;

    // eslint-disable-next-line no-console
    console.log(`[WS DEBUG #${instance_id}] creating socket`, {
        socket_url,
        endpoint: cleanedServer,
        app_id: cleanedAppId,
        raw_app_id_before_cleaning: rawAppId,
        created_at,
        currently_live_instances_before_this_one: live_count,
    });
    if (live_count > 0) {
        // eslint-disable-next-line no-console
        console.warn(
            `[WS DEBUG #${instance_id}] WARNING: ${live_count} other socket(s) are still CONNECTING/OPEN - multiple simultaneous connections detected.`,
            registry.instances.filter(i => i.state === 'CONNECTING' || i.state === 'OPEN')
        );
    }

    const deriv_socket = new WebSocket(socket_url);
    const record = {
        instance_id,
        socket_url,
        app_id: cleanedAppId,
        endpoint: cleanedServer,
        created_at,
        created_local: `${created_ts.local} (UTC${created_ts.offset})`,
        state: 'CONNECTING',
        create_stack,
        had_error: false,
        close_code: null,
        close_reason: null,
        first_message_at: null,
    };
    registry?.instances.push(record);

    // Wrap close() so we can tell whether *our own application code* ever calls it directly,
    // as opposed to the server closing the connection on us.
    const native_close = deriv_socket.close.bind(deriv_socket);
    deriv_socket.close = (...args) => {
        // eslint-disable-next-line no-console
        console.log(`[WS DEBUG #${instance_id}] application code called .close() explicitly`, {
            args,
            readyState_before_close: deriv_socket.readyState,
            stack: new Error('close() called here').stack,
        });
        return native_close(...args);
    };

    let first_message_logged = false;
    deriv_socket.addEventListener('open', () => {
        record.state = 'OPEN';
        record.opened_at = new Date().toISOString();
        // eslint-disable-next-line no-console
        console.log(`[WS DEBUG #${instance_id}] OPEN`, {
            socket_url,
            ms_since_created: Date.now() - new Date(created_at).getTime(),
        });
    });
    deriv_socket.addEventListener('close', event => {
        record.state = 'CLOSED';
        record.closed_at = new Date().toISOString();
        record.close_code = event.code;
        record.close_reason = event.reason || '';
        // eslint-disable-next-line no-console
        console.log(`[WS DEBUG #${instance_id}] CLOSE`, {
            socket_url,
            code: event.code,
            reason: event.reason || '(no reason given by server)',
            wasClean: event.wasClean,
            never_opened: !record.opened_at,
            ms_since_created: Date.now() - new Date(created_at).getTime(),
        });
    });
    deriv_socket.addEventListener('error', event => {
        record.had_error = true;
        // eslint-disable-next-line no-console
        console.log(`[WS DEBUG #${instance_id}] ERROR`, {
            socket_url,
            readyState: deriv_socket.readyState,
            event,
        });
    });
    deriv_socket.addEventListener('message', event => {
        if (first_message_logged) return;
        first_message_logged = true;
        record.first_message_at = new Date().toISOString();
        // eslint-disable-next-line no-console
        console.log(`[WS DEBUG #${instance_id}] first MESSAGE received`, event.data);
    });

    const deriv_api = new DerivAPIBasic({
        connection: deriv_socket,
        middleware: new APIMiddleware({}),
    });

    // Log exactly when authorize() is sent relative to the socket's readyState, to prove
    // whether auth is ever attempted before the connection is actually open.
    const native_authorize = deriv_api.authorize?.bind(deriv_api);
    if (native_authorize) {
        deriv_api.authorize = (...args) => {
            // eslint-disable-next-line no-console
            console.log(`[WS DEBUG #${instance_id}] authorize() called`, {
                readyState_at_call_time: deriv_socket.readyState,
                readyState_meaning: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][deriv_socket.readyState],
            });
            return native_authorize(...args);
        };
    }

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
