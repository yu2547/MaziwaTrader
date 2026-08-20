import { isDebugEnabled } from '@/utils/debug-log';

/**
 * Times one trade cycle so the slow step can be identified instead of guessed
 * at.
 *
 * The first attempt at speeding this up assumed the cost was the proposal
 * round-trip and tried to replace it with a subscription. Tested against the
 * live Options API, that subscription answers once and never streams - so the
 * change would have left the bot holding a dead price and quietly not trading.
 * Hence measuring first.
 *
 * Off unless localStorage mw_debug = '1', the same switch the rest of the
 * app's logging uses, so this costs a boolean read per trade in normal use and
 * needs no rebuild to turn on against a real session.
 */
const marks = {};
let cycle = 0;

export const markTiming = stage => {
    if (!isDebugEnabled()) return;
    marks[stage] = performance.now();
};

const gap = (from, to) => {
    const a = marks[from];
    const b = marks[to];
    if (!a || !b || b < a) return null;
    return Math.round(b - a);
};

const format = (label, from, to) => {
    const ms = gap(from, to);
    return ms === null ? null : `${label} ${ms}ms`;
};

/**
 * Prints the cycle once the contract has settled. Written as one line of
 * deltas rather than a timestamp per stage, because the question is which gap
 * is the big one - not when each thing happened.
 */
export const reportTiming = () => {
    if (!isDebugEnabled()) return;
    cycle += 1;

    const parts = [
        format('request→prices', 'proposals_requested', 'proposals_ready'),
        format('prices→buy', 'proposals_ready', 'buy_sent'),
        format('buy→accepted', 'buy_sent', 'buy_accepted'),
        format('accepted→settled', 'buy_accepted', 'settled'),
    ].filter(Boolean);

    const total = gap('proposals_requested', 'settled');

    // eslint-disable-next-line no-console
    console.info(`[MW-TIMING] trade ${cycle}  ${parts.join('  |  ')}${total === null ? '' : `  ||  total ${total}ms`}`);
};
