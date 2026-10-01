/**
 * Whether the bot may open its next contract, and how often.
 *
 * Two controls on the execution bar write here and the engine reads it, which
 * is the only way round this can work: the engine is framework-free and knows
 * nothing about MobX, and a store that reached into the engine would have to
 * import it. A module both sides can see costs one file and no coupling.
 *
 * Both answers are read at one place in the engine - the top of purchase() -
 * and both fail open: if nothing has ever been set here, canPurchase() is true
 * and the bot trades exactly as it did before this file existed. Anything that
 * goes wrong with pacing therefore costs a trade's timing, never a trade.
 */

/** Paused: the bot holds between contracts, and the run stays up. */
let is_paused = false;

/**
 * Slow: a floor on how often a contract may be opened. The bot is otherwise
 * tick-driven and will buy as soon as its conditions are met, which on a
 * one-second market is as often as once a second.
 */
let is_slow = false;

/**
 * How long SLOW holds between one purchase and the next. Six seconds is long
 * enough to read what just happened on a one-second market and short enough
 * that the bot is plainly still working.
 */
const SLOW_INTERVAL_MS = 6000;

/** When the last purchase was allowed through, for the SLOW floor. */
let last_purchase_at = 0;

export const setPaused = (paused: boolean) => {
    is_paused = paused;
};

export const isPaused = () => is_paused;

export const setSlowExecution = (slow: boolean) => {
    is_slow = slow;
};

export const isSlowExecution = () => is_slow;

/**
 * Asked once, at the top of a purchase. Reporting a purchase is the caller's
 * job rather than this one's - a refused purchase must not restart the clock,
 * or a SLOW bot that is being turned down would wait out the interval again
 * for every attempt.
 */
export const canPurchase = (now = Date.now()) => {
    if (is_paused) return false;
    if (is_slow && last_purchase_at && now - last_purchase_at < SLOW_INTERVAL_MS) return false;
    return true;
};

/** Called when a purchase has actually gone out. */
export const markPurchased = (now = Date.now()) => {
    last_purchase_at = now;
};

/**
 * A run starting clears what the last one left behind: a bot paused and then
 * stopped must not come back up paused, and a fresh run should not be held by
 * the previous run's last purchase.
 */
export const resetPacing = () => {
    is_paused = false;
    last_purchase_at = 0;
};
