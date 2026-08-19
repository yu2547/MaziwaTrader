/**
 * Opt-in console logging for the app's own subsystems.
 *
 * The auth, Options-transport and market-feed modules each narrate what they
 * are doing. That narration is genuinely useful while something is being
 * diagnosed - it is how the OTP handshake and the balance stream were traced -
 * but on an ordinary load it is a few dozen lines of noise, and noise is not
 * free: it is what buried the errors that actually mattered while the run
 * failure was being hunted.
 *
 * So it is off unless asked for. Turn it on from the console with
 *
 *     localStorage.setItem('mw_debug', '1')
 *
 * and reload; `localStorage.removeItem('mw_debug')` turns it back off. No
 * rebuild or redeploy either way, which is the point - the logging has to be
 * reachable on production when a real session is the only place a problem
 * shows up.
 *
 * Errors are never gated. A failure should be visible whether or not anybody
 * remembered to switch logging on.
 */
const DEBUG_KEY = 'mw_debug';

/** Read per call rather than cached, so toggling it takes effect immediately. */
export const isDebugEnabled = (): boolean => {
    try {
        return localStorage.getItem(DEBUG_KEY) === '1';
    } catch {
        // Storage can be unavailable (private mode, blocked cookies). Quiet is
        // the safer default.
        return false;
    }
};

export type TDebugLogger = {
    /** Progress narration - only printed when debugging is switched on. */
    log: (stage: string, detail?: unknown) => void;
    /** Failures - always printed. */
    logError: (stage: string, detail?: unknown) => void;
};

export const createDebugLogger = (prefix: string): TDebugLogger => ({
    log: (stage, detail) => {
        if (!isDebugEnabled()) return;
        // eslint-disable-next-line no-console
        if (detail === undefined) console.info(`${prefix} ${stage}`);
        // eslint-disable-next-line no-console
        else console.info(`${prefix} ${stage}`, detail);
    },
    logError: (stage, detail) => {
        // eslint-disable-next-line no-console
        console.error(`${prefix} ${stage}`, detail);
    },
});

export default createDebugLogger;
