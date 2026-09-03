/**
 * Signals - the analyzer terminal.
 *
 * This view used to be a scanner of its own: a dark panel of live readouts
 * with an entropy guard and a separation test behind it. It is now the Signal
 * Analyzer (pages/signal-analyzer), which reads the same feed and reports the
 * same kind of thing in the terminal the reference asked for - so Signals is
 * that one implementation rather than a second one sitting beside it.
 *
 * The scanner's judgement logic is still here in signal-quality.ts, with its
 * tests, if it is ever wanted back; nothing imports it now. The scanner's own
 * component and its ~600 lines of stylesheet came out with this change - they
 * are in the history at 85565870~1 if you want them.
 */

export { default } from '../signal-analyzer';
