import { useEffect, useRef } from 'react';
import './dashboard-background.scss';

type TParticle = {
    x: number;
    y: number;
    r: number;
    speed: number;
    drift: number;
    alpha: number;
};

const PARTICLE_COUNT = 34;

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const DashboardBackground = () => {
    const canvas_ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvas_ref.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;

        let width = 0;
        let height = 0;
        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        let particles: TParticle[] = [];
        let raf_id: number;

        const makeParticle = (): TParticle => ({
            x: Math.random(),
            y: Math.random(),
            r: 0.6 + Math.random() * 1.6,
            speed: 0.008 + Math.random() * 0.014,
            drift: (Math.random() - 0.5) * 0.006,
            alpha: 0.12 + Math.random() * 0.22,
        });

        const resize = () => {
            width = canvas.clientWidth;
            height = canvas.clientHeight;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        resize();
        particles = Array.from({ length: PARTICLE_COUNT }, makeParticle);

        if (prefersReducedMotion()) {
            const drawStatic = () => {
                ctx.clearRect(0, 0, width, height);
                particles.forEach(p => {
                    ctx.beginPath();
                    ctx.fillStyle = `rgba(212, 175, 55, ${p.alpha * 0.6})`;
                    ctx.arc(p.x * width, p.y * height, p.r, 0, Math.PI * 2);
                    ctx.fill();
                });
            };

            drawStatic();
            const onResize = () => {
                resize();
                drawStatic();
            };
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }

        const draw = () => {
            ctx.clearRect(0, 0, width, height);
            particles.forEach(p => {
                p.y -= p.speed / 100;
                p.x += p.drift / 100;
                if (p.y < -0.02) {
                    p.y = 1.02;
                    p.x = Math.random();
                }
                if (p.x < -0.02) p.x = 1.02;
                if (p.x > 1.02) p.x = -0.02;

                const px = p.x * width;
                const py = p.y * height;
                const is_gold = p.r > 1.4;
                ctx.beginPath();
                ctx.fillStyle = is_gold ? `rgba(212, 175, 55, ${p.alpha})` : `rgba(47, 182, 224, ${p.alpha})`;
                ctx.arc(px, py, p.r, 0, Math.PI * 2);
                ctx.fill();
            });
            raf_id = requestAnimationFrame(draw);
        };

        raf_id = requestAnimationFrame(draw);

        const onResize = () => resize();
        window.addEventListener('resize', onResize);

        return () => {
            cancelAnimationFrame(raf_id);
            window.removeEventListener('resize', onResize);
        };
    }, []);

    return (
        <div className='mw-dash-bg' aria-hidden='true'>
            <canvas ref={canvas_ref} className='mw-dash-bg__canvas' />
        </div>
    );
};

export default DashboardBackground;
