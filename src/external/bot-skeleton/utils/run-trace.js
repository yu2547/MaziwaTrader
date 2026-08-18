import { config } from '../constants/config';
import { MessageTypes } from '../constants/messages';
import { observer as globalObserver } from './observer';

/**
 * TEMPORARY DIAGNOSTIC - remove once the execution stall is identified.
 *
 * A bot run that produces no contract currently produces no explanation
 * either: every stage between pressing Run and sending `buy` either succeeds
 * silently or waits forever on a promise that never settles, so the Journal
 * ends up empty and there is nothing to tell the two apart. This prints one
 * line per stage into the Journal - the surface the user can actually read on
 * a phone - so the last line printed names the stage execution reached.
 *
 * Deliberately routed through the existing `ui.log.notify` observer event
 * that journal-store already listens to. No new transport, no new store, and
 * nothing here touches trading logic - it only reports.
 */

// Some stages sit inside per-message subscriptions and would otherwise print
// on every tick. Each key is allowed a small number of lines and then goes
// quiet, so the Journal stays readable.
const emitted_counts = {};
const DEFAULT_LIMIT = 3;

export const runTrace = (step, detail = '', limit = DEFAULT_LIMIT) => {
    try {
        emitted_counts[step] = (emitted_counts[step] ?? 0) + 1;
        if (emitted_counts[step] > limit) return;

        const suffix = detail === '' ? '' : ` — ${detail}`;
        const line = `[TRACE ${emitted_counts[step]}] ${step}${suffix}`;

        // eslint-disable-next-line no-console
        console.info('[MW-TRACE]', step, detail);

        globalObserver.emit('ui.log.notify', {
            message: line,
            message_type: MessageTypes.NOTIFY,
            className: 'journal__text',
            // journal.playAudio() calls play() on the element it finds by id,
            // so an omitted sound throws on a null element.
            sound: config().lists.NOTIFICATION_SOUND[0][1],
        });
    } catch {
        // A diagnostic must never be the thing that breaks a run.
    }
};

/** Lets a fresh run start from a clean set of per-stage counters. */
export const resetRunTrace = () => {
    Object.keys(emitted_counts).forEach(key => delete emitted_counts[key]);
};

export default runTrace;
