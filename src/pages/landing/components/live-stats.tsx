import { useEffect, useRef, useState } from 'react';
import { useTranslations } from '@deriv-com/translations';
import './live-stats.scss';

type TStat = {
    label: string;
    value: number;
    suffix?: string;
    decimals?: number;
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const useCountUp = (target: number, active: boolean, decimals: number, duration_ms = 1400) => {
    const [value, setValue] = useState(active ? target : 0);
    const started = useRef(false);
    const factor = 10 ** decimals;

    useEffect(() => {
        if (!active || started.current) return;
        started.current = true;

        if (prefersReducedMotion()) {
            setValue(target);
            return;
        }

        const start = performance.now();
        let frame: number;

        const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / duration_ms);
            const eased = 1 - (1 - progress) * (1 - progress);
            setValue(Math.round(target * eased * factor) / factor);
            if (progress < 1) frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [active, target, duration_ms, factor]);

    return value;
};

const StatItem = ({ stat, active }: { stat: TStat; active: boolean }) => {
    const value = useCountUp(stat.value, active, stat.decimals ?? 0);
    const display = stat.decimals ? value.toFixed(stat.decimals) : Math.round(value).toLocaleString();
    return (
        <div className='mw-stats__item'>
            <span className='mw-stats__value'>
                {display}
                {stat.suffix}
            </span>
            <span className='mw-stats__label'>{stat.label}</span>
        </div>
    );
};

const LiveStats = () => {
    const { localize } = useTranslations();
    const ref = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(false);

    useEffect(() => {
        const node = ref.current;
        if (!node) return undefined;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) setActive(true);
            },
            { threshold: 0.4 }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const stats: TStat[] = [
        { label: localize('Markets Available'), value: 50, suffix: '+' },
        { label: localize('Active Strategies'), value: 12842 },
        { label: localize('Trades Executed'), value: 2.8, suffix: 'M+', decimals: 1 },
        { label: localize('System Uptime'), value: 99.97, suffix: '%', decimals: 2 },
    ];

    return (
        <section className='mw-stats' ref={ref}>
            {stats.map(stat => (
                <StatItem key={stat.label} stat={stat} active={active} />
            ))}
        </section>
    );
};

export default LiveStats;
