import { localize } from '@deriv-com/translations';
import { observer as globalObserver } from '../../../utils/observer';
import { getLastDigit } from './helpers';

/**
 * Virtual Hook: trade on paper first, commit money later.
 *
 * While the hook is watching, the bot does not send `buy`. It takes the entry
 * tick, waits out the contract's duration on the real tick stream, and scores
 * what the outcome would have been. Once that has produced the configured
 * number of virtual losses it switches to real trading, and after the
 * configured number of real wins it goes back to watching.
 *
 * Nothing here fabricates a trade. A virtual result is a decision about
 * whether to risk money next time - it never reaches Transactions, Summary,
 * the balance or Deriv. The only trace it leaves is a journal line saying a
 * virtual trade was scored, which is deliberate: a bot that appears to sit
 * doing nothing for minutes is indistinguishable from a broken one.
 */

/**
 * Scored from the tick at expiry against the entry tick. Every one of these is
 * a rule the contract itself is settled by, not an approximation.
 */
const evaluators = {
    DIGITOVER: ({ exit_digit, prediction }) => exit_digit > prediction,
    DIGITUNDER: ({ exit_digit, prediction }) => exit_digit < prediction,
    DIGITEVEN: ({ exit_digit }) => exit_digit % 2 === 0,
    DIGITODD: ({ exit_digit }) => exit_digit % 2 !== 0,
    DIGITMATCH: ({ exit_digit, prediction }) => exit_digit === prediction,
    DIGITDIFF: ({ exit_digit, prediction }) => exit_digit !== prediction,
    CALL: ({ entry_quote, exit_quote }) => exit_quote > entry_quote,
    PUT: ({ entry_quote, exit_quote }) => exit_quote < entry_quote,
};

export const canEvaluateVirtually = (contract_type, duration_unit) =>
    Boolean(evaluators[contract_type]) && duration_unit === 't';

export default class VirtualHookRunner {
    constructor() {
        this.settings = { enabled: false, max_virtual_loss_steps: 1, required_real_wins: 1, virtual_stake: 0 };
        this.reset();
    }

    reset() {
        // Starts watching rather than trading - the point of the hook is that
        // the first real contract is earned, not assumed.
        this.mode = 'virtual';
        this.virtual_losses = 0;
        this.real_wins = 0;
        this.has_warned_unsupported = false;
    }

    configure(settings) {
        this.settings = settings;
        this.reset();
    }

    get is_enabled() {
        return Boolean(this.settings.enabled);
    }

    /** True when the next contract should be paper rather than money. */
    isWatching() {
        return this.is_enabled && this.mode === 'virtual';
    }

    /**
     * A contract shape this cannot settle honestly - a non-tick duration, or a
     * type with no rule above. Rather than guess an outcome, the hook stands
     * down and the bot trades normally, which is what it would have done if
     * the hook were switched off.
     */
    standDown(contract_type) {
        if (this.has_warned_unsupported) return;
        this.has_warned_unsupported = true;
        globalObserver.emit(
            'ui.log.error',
            localize(
                'Virtual Hook cannot score {{contract_type}} contracts, so it is trading normally. It supports digit and rise/fall contracts measured in ticks.',
                { contract_type }
            )
        );
    }

    recordVirtualResult(is_win) {
        if (is_win) {
            // A virtual win is not progress toward entering. The hook is
            // waiting for the losing run it was configured to sit out.
            this.virtual_losses = 0;
        } else {
            this.virtual_losses += 1;
        }

        const reached = this.virtual_losses >= this.settings.max_virtual_loss_steps;
        if (reached) {
            this.mode = 'real';
            this.virtual_losses = 0;
            this.real_wins = 0;
        }
        return reached;
    }

    recordRealResult(is_win) {
        if (!this.is_enabled || this.mode !== 'real') return false;
        if (!is_win) return false;

        this.real_wins += 1;
        const reached = this.real_wins >= this.settings.required_real_wins;
        if (reached) {
            this.mode = 'virtual';
            this.real_wins = 0;
            this.virtual_losses = 0;
        }
        return reached;
    }

    /**
     * Scores one paper contract. `nextTick` is expected to resolve with the
     * next real tick, so the wait is paced by the market rather than by a
     * timer - and a duration of N ticks costs exactly N ticks, like the real
     * contract it stands in for.
     */
    async score({ contract_type, prediction, duration, pip_size, entry_tick, nextTick }) {
        const evaluate = evaluators[contract_type];
        if (!evaluate) return null;

        let tick = entry_tick;
        for (let i = 0; i < Math.max(1, duration); i += 1) {
            // eslint-disable-next-line no-await-in-loop
            tick = await nextTick();
            if (!tick) return null;
        }

        const is_win = evaluate({
            entry_quote: entry_tick,
            exit_quote: tick,
            exit_digit: getLastDigit(tick.toFixed(pip_size)),
            prediction: Number(prediction),
        });

        this.recordVirtualResult(is_win);
        return is_win;
    }
}
