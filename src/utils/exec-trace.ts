/**
 * TEMPORARY execution diagnostic for the Run -> trade -> transaction chain.
 *
 * Every stage of the chain reports through here under one prefix, so a single
 * console filter shows the whole run in order and the first stage that failed
 * is named explicitly rather than inferred.
 *
 * Deliberately always on: this is meant to be captured in one pass on a demo
 * account without the user first having to set a flag, and a missed capture
 * costs another full round trip. It is not gated behind mw_debug for that
 * reason, which is also why it must not outlive the investigation.
 *
 * TO REMOVE: delete this file and the `execTrace`/`execTraceFail` imports and
 * call sites. They are all tagged with the comment marker MAZIWA-EXEC, so
 *     grep -rn "MAZIWA-EXEC" src/
 * finds every one of them.
 *
 * NOTHING SENSITIVE IS LOGGED. Call sites pass named scalar fields only -
 * never a whole API response, never a token, never account credentials. A
 * proposal id and a contract id are short-lived server-side references, not
 * secrets, and the balance figure is already on screen.
 */

const PREFIX = '[MAZIWA-EXEC]';

/** Stages in the order the chain should produce them. */
export const EXEC_STAGE = {
    /** The click itself, before any of the handler's early returns. */
    RUN_CLICKED: 'RUN_CLICKED',
    /** Run was clicked but the handler returned before starting the engine. */
    RUN_ABORTED: 'RUN_ABORTED',
    BOT_STARTED: 'BOT_STARTED',
    PROPOSAL_REQUEST: 'PROPOSAL_REQUEST',
    PROPOSAL_SUCCESS: 'PROPOSAL_SUCCESS',
    PROPOSAL_FAILURE: 'PROPOSAL_FAILURE',
    BUY_REQUEST: 'BUY_REQUEST',
    BUY_SUCCESS: 'BUY_SUCCESS',
    BUY_FAILURE: 'BUY_FAILURE',
    CONTRACT_UPDATE: 'CONTRACT_UPDATE',
    TRANSACTION_PUSHED: 'TRANSACTION_PUSHED',
    STATISTICS: 'STATISTICS',
    BALANCE_UPDATED: 'BALANCE_UPDATED',
    BOT_STOPPED: 'BOT_STOPPED',
} as const;

type TDetail = Record<string, string | number | boolean | null | undefined>;

let sequence = 0;
let run_started_at = 0;
let first_failure: string | null = null;
/** CONTRACT_UPDATE fires per tick; only the first few are worth printing. */
let contract_update_count = 0;

const elapsed = () => (run_started_at ? `+${String(Date.now() - run_started_at).padStart(5)}ms` : '        --');

const render = (detail: TDetail) =>
    Object.entries(detail)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');

export const execTrace = (stage: string, detail: TDetail = {}) => {
    // The click starts the clock, not BOT_STARTED - a run that aborts before
    // the engine starts still needs its stages timed and numbered.
    if (stage === EXEC_STAGE.RUN_CLICKED) {
        sequence = 0;
        run_started_at = Date.now();
        first_failure = null;
        contract_update_count = 0;
    }

    // A settling contract emits proposal_open_contract on every tick. Printing
    // all of them buries the stages that only happen once; the first three
    // prove updates are arriving, which is the only thing this stage answers.
    if (stage === EXEC_STAGE.CONTRACT_UPDATE) {
        contract_update_count += 1;
        if (contract_update_count === 4) {
            // eslint-disable-next-line no-console
            console.info(`${PREFIX} CONTRACT_UPDATE ... (further per-tick updates suppressed)`);
        }
        if (contract_update_count >= 4) return;
    }

    sequence += 1;
    const body = render(detail);
    // eslint-disable-next-line no-console
    console.info(`${PREFIX} #${String(sequence).padStart(2)} ${elapsed()} ${stage}${body ? ` ${body}` : ''}`);
};

/**
 * A stage that did not complete. The first one is the answer to "where does
 * the chain break", so it is called out once, loudly, and never overwritten by
 * later failures that are only consequences of it.
 */
export const execTraceFail = (stage: string, detail: TDetail = {}) => {
    const is_first = !first_failure;
    if (is_first) first_failure = stage;

    sequence += 1;
    const body = render(detail);
    // eslint-disable-next-line no-console
    console.error(`${PREFIX} #${String(sequence).padStart(2)} ${elapsed()} ${stage}${body ? ` ${body}` : ''}`);

    if (is_first) {
        // eslint-disable-next-line no-console
        console.error(`${PREFIX} >>> FIRST FAILED STAGE: ${stage} <<<`);
    }
};
