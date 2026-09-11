/**
 * Waits for Bot Builder's Blockly workspace to exist.
 *
 * Every "load this bot into Bot Builder" path used to switch tabs and then
 * sleep a flat 1500ms before reading window.Blockly.derivWorkspace. That is
 * wrong in both directions. On a cold start - the Bot Builder chunk still
 * downloading, Blockly still injecting its workspace - 1500ms is not enough,
 * the read comes back undefined and the load fails with "Bot Builder workspace
 * not found. Please try again." On a warm one the workspace is ready in a
 * fraction of that and the wait is dead time on every single load.
 *
 * Polling fixes both: it returns the moment the workspace appears, and it
 * keeps waiting while it has not.
 *
 * Returns null on timeout rather than throwing, so callers keep deciding what
 * to tell the person.
 */
const POLL_INTERVAL_MS = 60;

export const waitForDerivWorkspace = async (timeout_ms = 15000): Promise<unknown | null> => {
    const deadline = Date.now() + timeout_ms;

    // The common case: already there, so nothing is waited for at all.
    for (;;) {
        const workspace = (window as { Blockly?: { derivWorkspace?: unknown } }).Blockly?.derivWorkspace;
        if (workspace) return workspace;
        if (Date.now() >= deadline) return null;
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
};

export default waitForDerivWorkspace;
