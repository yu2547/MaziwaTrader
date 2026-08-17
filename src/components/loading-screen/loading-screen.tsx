import { useEffect, useRef, useState } from 'react';
import { useTranslations } from '@deriv-com/translations';
import LoadingCanvas from './loading-canvas';
import './loading-screen.scss';

export type TLoadingScreenProps = {
    // True once the app's real init (TMB check + API init, tracked in
    // app-root.tsx) has actually finished - this screen never claims 100%/
    // "Ready" before that is true, no matter how the staged animation below
    // is progressing.
    ready: boolean;
    // Called once the exit transition has fully finished, so the parent can
    // unmount this screen and reveal the app underneath.
    onExited: () => void;
};

// Cosmetic staging only (not real progress) - the brief asks for a scripted
// ~2-3s reveal with named stages. Timed to land on the last stage right
// around when real init typically finishes (app-root's own 2000ms fallback),
// and if real init is genuinely slower, we hold here rather than lie.
const STAGES = [
    { pct: 0, message: 'Initializing MaziwaTrader...' },
    { pct: 16, message: 'Loading Trading Engine...' },
    { pct: 33, message: 'Connecting to Live Markets...' },
    { pct: 50, message: 'Preparing Workspace...' },
    { pct: 68, message: 'Synchronizing Services...' },
    { pct: 85, message: 'Launching Platform...' },
];
const READY_STAGE = { pct: 100, message: 'Ready' };
const STAGE_INTERVAL_MS = 350;
// Once real init has finished there is nothing left to wait for, so the
// remaining stages catch up at this pace instead of the full interval. Every
// stage is still shown, in order, with the same visuals - the sequence just
// stops padding time the app no longer needs. Previously the screen always sat
// through the whole scripted run (5 x 350ms) before it was even allowed to
// reach "Ready", however fast the app had actually started.
const STAGE_INTERVAL_CATCHUP_MS = 90;
const READY_HOLD_MS = 550;
const EXIT_DURATION_MS = 600; // keep in sync with $exit-duration in loading-screen.scss

const MAX_FOREGROUND_PARTICLES = 8;

type TFloatingTick = { id: number; value: string; side: 'left' | 'right'; x: number; y: number; fading: boolean };

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Randomized spawn/lifetime per tick (not a fixed looping set) so the
// "floating market data" never visibly repeats on a cycle.
const useFloatingTicks = (reduced_motion: boolean) => {
    const [ticks, setTicks] = useState<TFloatingTick[]>([]);
    const next_id = useRef(0);

    useEffect(() => {
        if (reduced_motion) return undefined;
        let cancelled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];

        const spawn = () => {
            if (cancelled) return;
            setTicks(prev => {
                if (prev.length >= 5) return prev;
                const id = next_id.current++;
                const side: 'left' | 'right' = Math.random() > 0.5 ? 'left' : 'right';
                const value = `${Math.random() > 0.5 ? '+' : '-'}${(Math.random() * 0.6).toFixed(2)}`;
                const x = side === 'left' ? 4 + Math.random() * 24 : 72 + Math.random() * 24;
                const y = 16 + Math.random() * 62;
                timers.push(
                    setTimeout(() => setTicks(p => p.map(t => (t.id === id ? { ...t, fading: true } : t))), 2200)
                );
                timers.push(setTimeout(() => setTicks(p => p.filter(t => t.id !== id)), 2600));
                return [...prev, { id, value, side, x, y, fading: false }];
            });
            timers.push(setTimeout(spawn, 650 + Math.random() * 900));
        };

        timers.push(setTimeout(spawn, 350));
        return () => {
            cancelled = true;
            timers.forEach(clearTimeout);
        };
    }, [reduced_motion]);

    return ticks;
};

const LoadingScreen = ({ ready, onExited }: TLoadingScreenProps) => {
    const { localize } = useTranslations();
    const reduced_motion = prefersReducedMotion();

    const [stage_index, setStageIndex] = useState(0);
    const [phase, setPhase] = useState<'loading' | 'ready' | 'exiting'>('loading');
    const ticks = useFloatingTicks(reduced_motion);

    // Advance through the staged sequence, capped at the last pre-ready stage.
    useEffect(() => {
        if (phase !== 'loading' || stage_index >= STAGES.length - 1) return undefined;
        const interval = ready ? STAGE_INTERVAL_CATCHUP_MS : STAGE_INTERVAL_MS;
        const timer = setTimeout(() => setStageIndex(i => i + 1), reduced_motion ? 0 : interval);
        return () => clearTimeout(timer);
    }, [phase, stage_index, reduced_motion, ready]);

    // Only move to the "Ready" phase once the app is genuinely ready.
    useEffect(() => {
        if (phase === 'loading' && ready && stage_index >= STAGES.length - 1) {
            setPhase('ready');
        }
    }, [phase, ready, stage_index]);

    useEffect(() => {
        if (phase !== 'ready') return undefined;
        const timer = setTimeout(() => setPhase('exiting'), reduced_motion ? 0 : READY_HOLD_MS);
        return () => clearTimeout(timer);
    }, [phase, reduced_motion]);

    useEffect(() => {
        if (phase !== 'exiting') return undefined;
        const timer = setTimeout(onExited, reduced_motion ? 0 : EXIT_DURATION_MS);
        return () => clearTimeout(timer);
    }, [phase, reduced_motion, onExited]);

    const current = phase === 'loading' ? STAGES[stage_index] : READY_STAGE;
    const is_ready_visual = phase !== 'loading';

    return (
        <div
            className={`mw-loading ${phase === 'exiting' ? 'mw-loading--exiting' : ''} ${is_ready_visual ? 'mw-loading--ready' : ''}`}
            role='status'
            aria-live='polite'
        >
            <div className='mw-loading__scene'>
                <div className='mw-loading__bg' aria-hidden='true'>
                    <div className='mw-loading__vignette' />
                    <div className='mw-loading__glow mw-loading__glow--blue' />
                    <div className='mw-loading__glow mw-loading__glow--gold' />
                    <div className='mw-loading__rays' />
                    <LoadingCanvas progress={current.pct} />
                    {/* Six so the floor always has rings at several depths at
                        once - three left visible gaps between sweeps. */}
                    <div className='mw-loading__rings'>
                        {Array.from({ length: 6 }, (_, i) => (
                            <span key={i} className='mw-loading__ring' />
                        ))}
                    </div>
                </div>

                <div className='mw-loading__ticks' aria-hidden='true'>
                    {ticks.map(tick => (
                        <span
                            key={tick.id}
                            className={`mw-loading__tick mw-loading__tick--${tick.side} ${tick.fading ? 'mw-loading__tick--fading' : ''}`}
                            style={{ left: `${tick.x}%`, top: `${tick.y}%` }}
                        >
                            {tick.value}
                        </span>
                    ))}
                </div>

                <div className='mw-loading__content'>
                    <div className='mw-loading__logo-stage'>
                        <div
                            className={`mw-loading__logo-wrap ${is_ready_visual ? 'mw-loading__logo-wrap--ready' : ''}`}
                        >
                            <div className='mw-loading__logo-glow' aria-hidden='true' />
                            <img src='/maziwatrader-logo-v3.png' alt='MaziwaTrader' className='mw-loading__logo' />
                            <div className='mw-loading__logo-sweep' aria-hidden='true' />
                        </div>
                    </div>

                    <div className='mw-loading__counter'>
                        <span className='mw-loading__counter-label'>{localize('LOADING')}</span>
                        <span className='mw-loading__counter-value'>{current.pct}%</span>
                    </div>

                    <div className='mw-loading__bar-track'>
                        <div className='mw-loading__bar-fill' style={{ width: `${current.pct}%` }}>
                            <span className='mw-loading__bar-sheen' />
                        </div>
                    </div>

                    <div className='mw-loading__status' key={stage_index}>
                        {localize(current.message)}
                    </div>
                </div>

                <div className='mw-loading__fg-particles' aria-hidden='true'>
                    {Array.from({ length: MAX_FOREGROUND_PARTICLES }, (_, i) => (
                        <span
                            key={i}
                            className='mw-loading__particle'
                            style={{
                                left: `${(i * 137.5) % 100}%`,
                                top: `${(i * 53.7) % 100}%`,
                                animationDelay: `${(i % 8) * 0.9}s`,
                                animationDuration: `${9 + (i % 5)}s`,
                            }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default LoadingScreen;
