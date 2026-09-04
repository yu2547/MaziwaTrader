/**
 * The sound the AI scanner makes while it is working.
 *
 * Rebuilt from measurements of the reference recording rather than from a
 * description of it. What was measured, and is reproduced here:
 *
 *   - a 1.5s loop of 8 clicks at 94/101/103/100/101/90/95ms, then 816ms silence
 *   - two variants, A and B, alternating - a 3s super-cycle
 *   - each click 1-5ms attack, 41-56ms decay, over inside 60ms
 *   - energy 12% in 2-4kHz, 39% in 4-8kHz, 49% above 8kHz, and none below 2kHz
 *   - peaks at 3891, 4500, 5098, 8391, 9586 and 10184Hz
 *   - per-click levels spanning -11 to -26dB, in a fixed pattern
 *
 * Synthesised, never sampled: six sine partials at the measured frequencies,
 * struck together and decaying at slightly different rates, which is what makes
 * a tick read as metal rather than as a beep. Deterministic throughout - no
 * random pitch, no random timing, nothing that drifts between loops.
 *
 * The engine knows nothing about scanning. It is started and stopped by the
 * scanner's own is_scanning state (entry-scanner.tsx), so the sound lasts
 * exactly as long as the scan does. There is no completion sound, because the
 * reference has none: its loop simply stops, mid-pattern.
 */

/**
 * Where each click falls inside the loop, in milliseconds from its start.
 * These are the measured gaps accumulated: 94, 101, 103, 100, 101, 90, 95.
 */
const CLICK_OFFSETS_MS = [0, 94, 195, 298, 398, 499, 589, 684];

/** The loop, measured at 1499-1501ms across four repeats. */
const LOOP_MS = 1500;

/**
 * Per-click peak level in dB, exactly as measured. The contrast between the
 * loud clicks and the quiet ones is most of what gives the pattern its shape,
 * so these are not levelled out. A and B differ chiefly at the fourth click.
 */
const LOOP_A_DB = [-25.9, -16.5, -25.0, -11.1, -11.5, -13.3, -25.0, -12.2];
const LOOP_B_DB = [-24.6, -16.6, -23.6, -23.2, -11.2, -13.0, -24.1, -12.6];

/**
 * The six partials, at the frequencies the spectrum peaked on. Weights are set
 * so the summed energy lands on the measured split - 12.3% in 2-4kHz, 37.1% in
 * 4-8kHz, 50.6% above 8kHz, against a measured 12/39/49 - and they sum to 1, so
 * a click's peak is the level asked for rather than six times it.
 *
 * Decays run 56ms at the bottom to 41ms at the top: the measured range, and the
 * way a struck metal object actually behaves, with its highest partials dying
 * first.
 */
const PARTIALS = [
    { decay_s: 0.056, hz: 3891, weight: 0.62 },
    { decay_s: 0.051, hz: 4500, weight: 0.8 },
    { decay_s: 0.049, hz: 5098, weight: 0.72 },
    { decay_s: 0.045, hz: 8391, weight: 0.78 },
    { decay_s: 0.043, hz: 9586, weight: 0.85 },
    { decay_s: 0.041, hz: 10184, weight: 0.5 },
];
const WEIGHT_SUM = PARTIALS.reduce((total, partial) => total + partial.weight, 0);

/** Measured mean, and inside the 1-5ms the reference clicks attack over. */
const ATTACK_S = 0.003;

/**
 * How loud the whole thing plays, against a reference burst that peaks at
 * -8.4dBFS. At 0.35 the loudest click lands near -18dBFS - the reference's
 * dynamics at a level that sits under a trading screen rather than over it.
 * Set this to 1 to play at the reference's own level.
 */
const MASTER_GAIN = 0.35;

/** Nothing below 2kHz, which is where the reference has nothing. */
const HIGHPASS_HZ = 2000;

// Scheduling: clicks are handed to the audio clock this far ahead, and the
// queue is topped up on this interval. Both well inside the loop, so timing
// comes from the audio thread rather than from setInterval's drift.
const SCHEDULE_AHEAD_S = 0.4;
const TOP_UP_MS = 150;

const dbToAmp = (db: number) => 10 ** (db / 20);

class ScanSound {
    private context: AudioContext | null = null;
    private bus: BiquadFilterNode | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private suspend_timer: ReturnType<typeof setTimeout> | null = null;
    private scheduled = new Set<OscillatorNode>();
    private is_running = false;
    /** Audio-clock time the current run's first loop begins at. */
    private started_at = 0;
    /** How many loops have been handed to the clock; also picks A or B. */
    private loop_index = 0;

    /**
     * Opens the context inside the click that starts a scan.
     *
     * Safari will only honour a resume() that happens in the gesture's own call
     * stack, and a React effect runs after that stack has unwound - so the
     * scanner primes here on press and lets the effect start the pattern.
     */
    prime() {
        if (!this.context) {
            const Ctor =
                window.AudioContext ??
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctor) return;
            this.context = new Ctor();
            // One filter for the whole engine: the partials carry no low end,
            // but a 3ms attack does, and this keeps that where the reference
            // keeps it.
            this.bus = this.context.createBiquadFilter();
            this.bus.type = 'highpass';
            this.bus.frequency.value = HIGHPASS_HZ;
            this.bus.connect(this.context.destination);
        }
        if (this.suspend_timer) {
            clearTimeout(this.suspend_timer);
            this.suspend_timer = null;
        }
        if (this.context.state === 'suspended') {
            this.context.resume().catch(() => {
                // Refused without a gesture: the scan runs on in silence.
            });
        }
    }

    start() {
        if (this.is_running) return;
        this.prime();
        if (!this.context || !this.bus) return;
        this.is_running = true;
        this.loop_index = 0;
        // A beat of headroom so the first loop is scheduled rather than raced.
        this.started_at = this.context.currentTime + 0.06;
        this.fill();
        this.timer = setInterval(() => this.fill(), TOP_UP_MS);
    }

    /**
     * Everything this engine owns, released: the top-up timer, and every click
     * that was queued but has not sounded yet. A click already sounding is left
     * to finish - it is under 60ms long and stopping it mid-ring would put a
     * click of its own on the end of every scan.
     */
    stop() {
        this.is_running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        const now = this.context?.currentTime ?? 0;
        this.scheduled.forEach(source => {
            try {
                // stop() at or before a source's start time means it never
                // sounds at all; for one already playing this is a no-op, since
                // its own stop is already scheduled.
                source.stop(now);
            } catch {
                // Already finished, and already cleaned up by onended.
            }
        });
        this.scheduled.clear();

        // Suspended rather than closed, and only once the last click has rung
        // out, so the next scan resumes this context instead of asking the
        // browser for another.
        this.suspend_timer = setTimeout(() => {
            this.suspend_timer = null;
            this.context?.suspend().catch(() => {
                // Nothing to suspend, which is the state we wanted anyway.
            });
        }, 120);
    }

    /** Hands the audio clock every loop that begins inside the horizon. */
    private fill() {
        const context = this.context;
        if (!this.is_running || !context) return;
        const horizon = context.currentTime + SCHEDULE_AHEAD_S;
        while (this.started_at + (this.loop_index * LOOP_MS) / 1000 < horizon) {
            this.scheduleLoop(this.loop_index);
            this.loop_index += 1;
        }
    }

    /** Loop A on even indices, B on odd - the measured 3s super-cycle. */
    private scheduleLoop(index: number) {
        const base = this.started_at + (index * LOOP_MS) / 1000;
        const levels = index % 2 === 0 ? LOOP_A_DB : LOOP_B_DB;
        CLICK_OFFSETS_MS.forEach((offset, position) => {
            this.click(base + offset / 1000, levels[position]);
        });
    }

    /**
     * One metallic tick at `at`, peaking at `db`.
     *
     * Six sine partials struck together, each with its own decay. Sines rather
     * than a square or noise because the measured spectrum is a handful of
     * discrete peaks, not a harmonic series and not a flat band.
     */
    private click(at: number, db: number) {
        const context = this.context;
        const bus = this.bus;
        if (!context || !bus) return;

        const amplitude = dbToAmp(db) * MASTER_GAIN;

        PARTIALS.forEach(partial => {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            const peak = amplitude * (partial.weight / WEIGHT_SUM);

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(partial.hz, at);

            gain.gain.setValueAtTime(0, at);
            gain.gain.linearRampToValueAtTime(peak, at + ATTACK_S);
            // Exponential toward silence, which is how a struck body decays;
            // the target is nonzero because the ramp cannot reach zero.
            gain.gain.exponentialRampToValueAtTime(peak * 0.001, at + partial.decay_s);

            oscillator.connect(gain).connect(bus);
            oscillator.start(at);
            oscillator.stop(at + partial.decay_s + 0.01);

            this.scheduled.add(oscillator);
            oscillator.onended = () => {
                this.scheduled.delete(oscillator);
                oscillator.disconnect();
                gain.disconnect();
            };
        });
    }
}

export const scan_sound = new ScanSound();
