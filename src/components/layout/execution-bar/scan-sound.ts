/**
 * The sound the AI scanner makes while it is working.
 *
 * Synthesised - three short shapes (a click, a swept chirp, a quiet processing
 * pulse) fired at uneven intervals, so it reads as a machine going through
 * markets rather than a metronome. Nothing is loaded from anywhere.
 *
 * One AudioContext for the life of the tab, created on the first Scan press
 * and suspended between scans rather than closed and rebuilt - browsers only
 * allow a context to start inside a user gesture, and a context per scan would
 * eventually be refused.
 *
 * The engine knows nothing about scanning. It is started and stopped by the
 * scanner's own `is_scanning` state (entry-scanner.tsx), so the sound lasts
 * exactly as long as the scan does, however long that turns out to be.
 */

// Quiet enough to sit under a conversation, loud enough to notice stopping.
const MASTER_GAIN = 0.07;

// Gaps between events. Mostly quick, occasionally a breath, never the same
// twice - that unevenness is what makes it sound like work being done.
const GAP_MIN_MS = 80;
const GAP_MAX_MS = 350;
const PAUSE_MIN_MS = 400;
const PAUSE_MAX_MS = 700;
const PAUSE_CHANCE = 0.18;

const between = (min: number, max: number) => min + Math.random() * (max - min);

class ScanSound {
    private context: AudioContext | null = null;
    private master: GainNode | null = null;
    // Every pending timer, not just the next one: the double tap schedules its
    // second click on a timer of its own, and holding a single handle meant
    // that one could not be cancelled and could sound after the scan had
    // stopped.
    private timers = new Set<ReturnType<typeof setTimeout>>();
    private sources = new Set<AudioScheduledSourceNode>();
    private is_running = false;

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
            this.master = this.context.createGain();
            this.master.gain.value = MASTER_GAIN;
            this.master.connect(this.context.destination);
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
        if (!this.context || !this.master) return;
        this.is_running = true;
        this.schedule();
    }

    /**
     * Everything this engine owns, released: the pending timer, every
     * oscillator still sounding, and the graph they were connected to. Called
     * when the scan finishes, when the panel closes, and when the component
     * goes away - so nothing can be left playing over a scanner that no longer
     * exists.
     */
    stop() {
        this.is_running = false;
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.sources.forEach(source => {
            try {
                source.stop();
            } catch {
                // Already finished; onended has cleaned it up.
            }
            source.disconnect();
        });
        this.sources.clear();
        // Suspended rather than closed: the next scan resumes this one instead
        // of asking the browser for another.
        this.context?.suspend().catch(() => {
            // Nothing to suspend, which is the state we wanted anyway.
        });
    }

    /** Runs `action` later, and keeps the handle so stop() can cancel it. */
    private after(ms: number, action: () => void) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (this.is_running) action();
        }, ms);
        this.timers.add(timer);
    }

    private schedule() {
        if (!this.is_running) return;
        const gap =
            Math.random() < PAUSE_CHANCE ? between(PAUSE_MIN_MS, PAUSE_MAX_MS) : between(GAP_MIN_MS, GAP_MAX_MS);
        this.after(gap, () => {
            this.emit();
            this.schedule();
        });
    }

    /** One event: usually a click, sometimes a pair, a chirp or a pulse. */
    private emit() {
        const roll = Math.random();
        if (roll < 0.5) {
            this.click();
            return;
        }
        if (roll < 0.72) {
            // The double tap, close enough to read as one gesture.
            this.click();
            this.after(between(45, 80), () => this.click());
            return;
        }
        if (roll < 0.9) {
            this.chirp();
            return;
        }
        this.pulse();
    }

    private track(source: AudioScheduledSourceNode, gain: GainNode) {
        this.sources.add(source);
        source.onended = () => {
            this.sources.delete(source);
            source.disconnect();
            gain.disconnect();
        };
    }

    /** A contact: 20-50ms of square wave between 700 and 1500Hz. */
    private click() {
        const context = this.context;
        const master = this.master;
        if (!context || !master) return;

        const now = context.currentTime;
        const length = between(0.02, 0.05);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'square';
        oscillator.frequency.value = between(700, 1500);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.6, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
        oscillator.connect(gain).connect(master);
        this.track(oscillator, gain);
        oscillator.start(now);
        oscillator.stop(now + length + 0.01);
    }

    /** A sweep, 900Hz up to 1500Hz - the "looking at something" sound. */
    private chirp() {
        const context = this.context;
        const master = this.master;
        if (!context || !master) return;

        const now = context.currentTime;
        const length = between(0.06, 0.12);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(between(850, 950), now);
        oscillator.frequency.linearRampToValueAtTime(between(1400, 1600), now + length);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.35, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
        oscillator.connect(gain).connect(master);
        this.track(oscillator, gain);
        oscillator.start(now);
        oscillator.stop(now + length + 0.01);
    }

    /** Something ticking over underneath: quieter and lower than the rest. */
    private pulse() {
        const context = this.context;
        const master = this.master;
        if (!context || !master) return;

        const now = context.currentTime;
        const length = between(0.05, 0.1);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = between(320, 480);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
        oscillator.connect(gain).connect(master);
        this.track(oscillator, gain);
        oscillator.start(now);
        oscillator.stop(now + length + 0.01);
    }
}

export const scan_sound = new ScanSound();
