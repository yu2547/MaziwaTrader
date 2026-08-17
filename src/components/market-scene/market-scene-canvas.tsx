import { useEffect, useRef } from 'react';

// Shared cinematic "live market" background engine, used by both the loading
// screen and the landing page hero (per the explicit "avoid duplicated
// animation engines" requirement) - candles are generated procedurally frame
// by frame (regime-based trend/volatility, real open/high/low/close
// lifecycle) and projected in perspective - born large near the outer edges
// of the screen and shrinking/fading toward a shared vanishing point behind
// the hero logo, like a financial tunnel the camera sits inside. Runs
// entirely on its own rAF loop, independent of React re-renders, and tears
// itself down on unmount.
//
// This file is the loading screen's frozen engine, extracted verbatim - the
// only changes from that version are: the incoming intensity prop is now a
// pre-divided 0-1 "energy" value instead of a 0-100 "progress" value, the
// canvas className is a prop instead of hardcoded, and the CSS-var target
// selector (for the ambient/progress vars written each frame) is a prop
// instead of being hardcoded to the loading screen's own DOM structure.

const CANDLE_WIDTH = 8;
const CANDLE_GAP = 4;
const CANDLE_SLOT = CANDLE_WIDTH + CANDLE_GAP;
const CANDLE_DURATION_MS = 520;
const SCROLL_PX_PER_MS = CANDLE_SLOT / CANDLE_DURATION_MS;

// Perspective tuning - the vanishing point sits just above screen-center,
// roughly where the logo is. Candles/streaks are born at MIN_SCALE=1 near
// the outer edge of their strip and shrink toward MIN_SCALE as they approach
// the center, while their vertical band narrows toward the same point -
// this is what actually reads as "receding into the distance" rather than a
// flat horizontal scroll. The near band is deliberately tall (and the far
// band tight) so each side reads as a large financial "wall" framing the
// logo, converging to a crisp point rather than a vague blur.
const VP_Y_FRACTION = 0.37;
const NEAR_TOP_FRACTION = 0.1;
const NEAR_BOTTOM_FRACTION = 0.74;
const MIN_SCALE = 0.16;

type TCandle = {
    index: number;
    open: number;
    high: number;
    low: number;
    close: number;
};

type TRgb = { r: number; g: number; b: number };

type TStripConfig = {
    regionFrom: number;
    regionTo: number;
    // true: candles are born near regionFrom (the outer/screen edge) and age
    // toward regionTo (the center/vanishing point). false: mirrored.
    bornAtRegionStart: boolean;
    color: TRgb;
    glow: string;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpColor = (a: TRgb, b: TRgb, t: number): TRgb => ({
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
});
const rgba = (c: TRgb, a: number) => `rgba(${c.r | 0}, ${c.g | 0}, ${c.b | 0}, ${Math.max(0, a).toFixed(3)})`;

// What distant candles/streaks haze toward - a neutral, slightly cool tone
// so the far end of the tunnel softens rather than just going transparent.
/** How long one floor ring takes to travel from the horizon to the frame edge. */
const FLOOR_TRAVEL_MS = 7000;

const HAZE_RGB: TRgb = { r: 92, g: 110, b: 140 };
const GOLD_RGB: TRgb = { r: 255, g: 176, b: 68 };
const BLUE_RGB: TRgb = { r: 76, g: 168, b: 255 };

// Regime-based price walk: the strip alternates between bullish/bearish/quiet
// stretches with slowly-eased trend and volatility (rather than a flat
// random walk), throws in the occasional stronger "momentum" candle, and
// jitters its own candle-close cadence - this is what keeps candles from
// looking statistically identical to one another.
class CandleStrip {
    candles: TCandle[] = [];
    scroll_x = 0;
    private next_index = 1;
    private price = 0.5;
    private last_close = 0;
    private next_duration = CANDLE_DURATION_MS;
    private trend = 0;
    private trend_target = 0;
    private vol_mult = 1;
    private vol_target = 1;
    private regime_left = 0;

    constructor(private base_volatility: number) {
        this.candles.push({ index: 0, open: 0.5, high: 0.5, low: 0.5, close: 0.5 });
        this.pickRegime();
    }

    private pickRegime() {
        const roll = Math.random();
        if (roll < 0.35) {
            this.trend_target = 0.4 + Math.random() * 0.5; // bullish cluster
            this.vol_target = 0.9 + Math.random() * 0.7;
        } else if (roll < 0.7) {
            this.trend_target = -(0.4 + Math.random() * 0.5); // bearish cluster
            this.vol_target = 0.9 + Math.random() * 0.7;
        } else {
            this.trend_target = (Math.random() - 0.5) * 0.15; // quiet/choppy
            this.vol_target = 0.45 + Math.random() * 0.3;
        }
        this.regime_left = 4 + Math.floor(Math.random() * 7);
    }

    update(now: number, dt: number, energy: number) {
        this.scroll_x += SCROLL_PX_PER_MS * dt;

        // Ease toward regime targets rather than snapping - this is the
        // "subtle acceleration and deceleration" the market should have.
        // Scaled by dt (calibrated against a 60fps frame) so the pacing of
        // trend/volatility shifts looks the same regardless of the device's
        // actual frame rate, instead of easing twice as slowly at 30fps.
        const ease = Math.min(1, 0.02 * (dt / 16.67));
        this.trend += (this.trend_target - this.trend) * ease;
        this.vol_mult += (this.vol_target - this.vol_mult) * ease;

        const activity = 0.75 + energy * 0.55;
        const step =
            (Math.random() - 0.5) * this.base_volatility * this.vol_mult * activity +
            this.trend * this.base_volatility * 0.5;
        this.price = Math.min(0.92, Math.max(0.08, this.price + step));

        const forming = this.candles[this.candles.length - 1];
        forming.close = this.price;
        forming.high = Math.max(forming.high, this.price);
        forming.low = Math.min(forming.low, this.price);

        if (now - this.last_close > this.next_duration) {
            this.last_close = now;
            this.next_duration = CANDLE_DURATION_MS * (0.72 + Math.random() * 0.56);
            this.regime_left -= 1;
            if (this.regime_left <= 0) this.pickRegime();

            let close = forming.close;
            const momentum_chance = 0.08 + energy * 0.05;
            if (Math.random() < momentum_chance) {
                close = Math.min(0.94, Math.max(0.06, close + (Math.random() - 0.5) * this.base_volatility * 3.4));
                this.price = close;
            }

            const open = forming.close;
            this.candles.push({
                index: this.next_index++,
                open,
                high: Math.max(open, close),
                low: Math.min(open, close),
                close,
            });
        }

        // Bounded to roughly what a strip's region can ever actually show at
        // once, plus headroom - keeping the array any longer just means
        // iterating and culling off-screen candles every frame for no
        // visible benefit.
        const latest = this.next_index - 1;
        while (this.candles.length > 1 && latest - this.candles[0].index > 45) {
            this.candles.shift();
        }
    }
}

const createParticles = (count: number) =>
    Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        z: 0.25 + Math.random() * 0.75,
        vx: (Math.random() - 0.5) * 0.02,
        vy: -0.01 - Math.random() * 0.02,
        gold: Math.random() > 0.5,
    }));

const createStreaks = (count: number) =>
    Array.from({ length: count }, () => ({
        depth: Math.random(),
        lane: (Math.random() - 0.5) * 0.8,
    }));

const createFloorPulses = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
        angle: (i / count) * Math.PI * 2,
        speed: 0.25 + Math.random() * 0.25,
        radius_frac: 0.45 + Math.random() * 0.5,
    }));

// Depth-dependent visual scale/band, independent of how x is derived - used
// by both candles (whose x comes from the existing scroll formula) and
// streaks (whose x is derived directly from depth).
const easeDepth = (t: number) => Math.pow(Math.min(1, Math.max(0, t)), 1.1);
const depthVisual = (depthT: number, h: number) => {
    const eased = easeDepth(depthT);
    return {
        eased,
        scale: lerp(1, MIN_SCALE, eased),
        bandTop: lerp(h * NEAR_TOP_FRACTION, h * (VP_Y_FRACTION - 0.008), eased),
        bandBottom: lerp(h * NEAR_BOTTOM_FRACTION, h * (VP_Y_FRACTION + 0.008), eased),
    };
};

const stripX = (cfg: TStripConfig, depthT: number, w: number) => {
    const regionFromPx = cfg.regionFrom * w;
    const regionToPx = cfg.regionTo * w;
    const outerX = cfg.bornAtRegionStart ? regionFromPx : regionToPx;
    const innerX = cfg.bornAtRegionStart ? regionToPx : regionFromPx;
    return lerp(outerX, innerX, depthT);
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export type TMarketSceneCanvasProps = {
    // 0-1. The scene gets subtly more active/energized as this rises -
    // richer particles, stronger momentum candles, brighter glow.
    energy: number;
    // CSS selector (searched via the canvas's closest()) to write the
    // per-frame --mw-ambient/--mw-progress vars onto, for callers that want
    // surrounding DOM (e.g. CSS glow blobs) to breathe in sync with the
    // canvas. Omit to skip writing these entirely.
    ambientTargetSelector?: string;
    className?: string;
    // 'default' (the loading screen's frozen look, unchanged) or 'hero' -
    // a handful of realism refinements (crisper particles, a glassy candle
    // highlight, a soft depth-fog veil near the horizon, a subtle floor
    // reflection echo) that only apply when explicitly opted into, so the
    // loading screen's rendered output never changes just because this
    // shared engine gets improved for the landing page.
    variant?: 'default' | 'hero';
};

const MarketSceneCanvas = ({
    energy,
    ambientTargetSelector,
    className,
    variant = 'default',
}: TMarketSceneCanvasProps) => {
    const is_hero = variant === 'hero';
    const canvas_ref = useRef<HTMLCanvasElement>(null);
    const energy_ref = useRef(energy);

    useEffect(() => {
        energy_ref.current = energy;
    }, [energy]);

    useEffect(() => {
        const canvas = canvas_ref.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || prefersReducedMotion()) return undefined;

        const scene_el = ambientTargetSelector ? canvas.closest<HTMLElement>(ambientTargetSelector) : null;

        const strips: { cfg: TStripConfig; strip: CandleStrip }[] = [
            {
                cfg: {
                    regionFrom: 0,
                    regionTo: 0.42,
                    bornAtRegionStart: true,
                    color: GOLD_RGB,
                    glow: 'rgba(255, 176, 68, 0.6)',
                },
                strip: new CandleStrip(0.045),
            },
            {
                cfg: {
                    regionFrom: 0.58,
                    regionTo: 1,
                    bornAtRegionStart: false,
                    color: BLUE_RGB,
                    glow: 'rgba(76, 168, 255, 0.6)',
                },
                strip: new CandleStrip(0.045),
            },
        ];

        const particles = createParticles(44);
        const streaksLeft = createStreaks(4);
        const streaksRight = createStreaks(4);
        const floorPulses = createFloorPulses(3);

        // 0-1, advancing. Rings sit at their index offset by this, so the whole
        // set slides outward and the floor reads as ground travelling past the
        // camera instead of a static target painted under the logo. Only the
        // loading screen takes this - the landing hero's floor is unchanged.
        const is_travelling_floor = !is_hero;
        let floor_travel = 0;

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const { clientWidth, clientHeight } = canvas;
            canvas.width = clientWidth * dpr;
            canvas.height = clientHeight * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener('resize', resize);

        let raf = 0;
        let last_time = performance.now();
        let cssVarThrottle = 0;

        // Reused across frames instead of allocated fresh each tick - avoids
        // needless GC churn in a loop that's meant to run at 60fps.
        const light = { cx: 0, cy: 0, radius: 0, intensity: 0 };

        const drawLogoLight = (w: number, h: number, radius: number, intensity: number) => {
            light.cx = w * 0.5;
            light.cy = h * VP_Y_FRACTION;
            light.radius = radius;
            light.intensity = intensity;
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const grad = ctx.createRadialGradient(light.cx, light.cy, 0, light.cx, light.cy, radius);
            grad.addColorStop(0, `rgba(200, 216, 255, ${0.1 + intensity * 0.13})`);
            grad.addColorStop(0.55, `rgba(255, 176, 68, ${0.03 + intensity * 0.05})`);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(light.cx, light.cy, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            return light;
        };

        // A soft veil that gently softens the busiest, most-distant part of
        // the scene (right around the vanishing point) - real depth-of-field
        // makes far detail read as atmosphere rather than sharp clutter.
        // Hero-only: a subtractive, not additive, effect - it simplifies the
        // convergence point instead of adding another visual layer.
        const drawDepthFog = (w: number, h: number, brightness: number) => {
            const vpX = w * 0.5;
            const vpY = h * VP_Y_FRACTION;
            const grad = ctx.createRadialGradient(vpX, vpY, 0, vpX, vpY, Math.min(w, h) * 0.34);
            grad.addColorStop(0, `rgba(8, 12, 22, ${0.22 * brightness})`);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
        };

        // A soft tint across each strip's whole region, brightest at the
        // outer screen edge and fading toward the center - gives the many
        // individual candles a unifying sense of mass, so each side reads as
        // one large financial "wall" rather than a scatter of bars.
        const drawWallTint = (w: number, h: number, brightness: number) => {
            const top = h * NEAR_TOP_FRACTION * 0.7;
            const bottom = h * NEAR_BOTTOM_FRACTION;

            const left = ctx.createLinearGradient(0, 0, w * 0.42, 0);
            left.addColorStop(0, `rgba(255, 176, 68, ${0.045 * brightness})`);
            left.addColorStop(1, 'transparent');
            ctx.fillStyle = left;
            ctx.fillRect(0, top, w * 0.42, bottom - top);

            const right = ctx.createLinearGradient(w, 0, w * 0.58, 0);
            right.addColorStop(0, `rgba(76, 168, 255, ${0.045 * brightness})`);
            right.addColorStop(1, 'transparent');
            ctx.fillStyle = right;
            ctx.fillRect(w * 0.58, top, w * 0.42, bottom - top);
        };

        // Volumetric light: two soft wedges of light reaching from the
        // walls toward the vanishing point, brightest near the walls and
        // fading to nothing at the horizon - reinforces "light travelling
        // through space" without brightening the area right behind the logo,
        // which needs to stay the darkest point in the scene for contrast.
        const drawVolumetricLight = (w: number, h: number, brightness: number) => {
            const vpX = w * 0.5;
            const vpY = h * VP_Y_FRACTION;
            ctx.save();
            ctx.globalCompositeOperation = 'screen';

            const left = ctx.createLinearGradient(0, h * 0.42, vpX, vpY);
            left.addColorStop(0, `rgba(255, 196, 120, ${0.05 * brightness})`);
            left.addColorStop(1, 'transparent');
            ctx.fillStyle = left;
            ctx.beginPath();
            ctx.moveTo(0, h * NEAR_TOP_FRACTION);
            ctx.lineTo(vpX, vpY);
            ctx.lineTo(0, h * NEAR_BOTTOM_FRACTION);
            ctx.closePath();
            ctx.fill();

            const right = ctx.createLinearGradient(w, h * 0.42, vpX, vpY);
            right.addColorStop(0, `rgba(150, 205, 255, ${0.05 * brightness})`);
            right.addColorStop(1, 'transparent');
            ctx.fillStyle = right;
            ctx.beginPath();
            ctx.moveTo(w, h * NEAR_TOP_FRACTION);
            ctx.lineTo(vpX, vpY);
            ctx.lineTo(w, h * NEAR_BOTTOM_FRACTION);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        };

        // The financial tunnel: each candle is drawn at its own depth-scaled
        // size and within its own depth-narrowed vertical band, so the strip
        // reads as receding into the distance rather than a flat scrolling
        // row. x still comes from the original smooth scroll formula (born
        // near the outer edge, aging toward the center) - only scale/band/
        // color/alpha are new.
        const drawStrip = (
            { cfg, strip }: { cfg: TStripConfig; strip: CandleStrip },
            w: number,
            h: number,
            brightness: number
        ) => {
            const regionFromPx = cfg.regionFrom * w;
            const regionToPx = cfg.regionTo * w;
            const regionSpan = regionToPx - regionFromPx;
            const innerEdge = cfg.bornAtRegionStart ? regionToPx : regionFromPx;
            const latest = strip.candles[strip.candles.length - 1]?.index ?? 0;

            strip.candles.forEach(candle => {
                const offsetSlots = latest - candle.index;
                const x = cfg.bornAtRegionStart
                    ? regionFromPx + offsetSlots * CANDLE_SLOT - strip.scroll_x
                    : regionToPx - offsetSlots * CANDLE_SLOT + strip.scroll_x;

                if (x < regionFromPx - CANDLE_SLOT || x > regionToPx + CANDLE_SLOT) return;

                const depthT = 1 - Math.min(1, Math.abs(x - innerEdge) / regionSpan);
                const { eased, scale, bandTop, bandBottom } = depthVisual(depthT, h);
                if (eased > 0.985) return; // fully vanished into the horizon

                const bandHeight = bandBottom - bandTop;
                const yFor = (price: number) => bandTop + (1 - price) * bandHeight;
                const up = candle.close >= candle.open;

                // Atmospheric haze: distant candles desaturate toward a
                // neutral tone and dim, near ones stay sharp and vivid. The
                // hero variant hazes slightly less aggressively - a touch
                // more of the color survives into the distance, reading as
                // clearer air rather than fog.
                const color = lerpColor(cfg.color, HAZE_RGB, eased * (is_hero ? 0.5 : 0.62));
                const alpha = (1 - eased * 0.72) * brightness * (up ? 1 : 0.62);

                ctx.globalAlpha = alpha;
                ctx.strokeStyle = rgba(color, alpha);
                ctx.fillStyle = rgba(color, alpha);
                ctx.shadowColor = cfg.glow;
                ctx.shadowBlur = (is_hero ? 4 : 6) * (1 - eased * 0.6);
                ctx.lineWidth = Math.max(0.6, scale);

                ctx.beginPath();
                ctx.moveTo(x, yFor(candle.high));
                ctx.lineTo(x, yFor(candle.low));
                ctx.stroke();

                const bodyWidth = Math.max(1.4, CANDLE_WIDTH * scale);
                const bodyTop = yFor(Math.max(candle.open, candle.close));
                const bodyBottom = yFor(Math.min(candle.open, candle.close));
                const bodyHeight = Math.max(1.4, bodyBottom - bodyTop);
                ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);

                // A thin brighter sliver along the top edge - a cheap glass/
                // glossy highlight instead of a flat matte rectangle. Skipped
                // for tiny/far candles where it wouldn't read as anything but
                // noise.
                if (is_hero && bodyWidth > 2.5) {
                    ctx.globalAlpha = alpha * 0.5;
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, Math.min(1.2, bodyHeight * 0.18));
                }
            });
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        };

        // Long light streaks travelling the same perspective lanes the
        // candles occupy (from the vanishing point outward, toward the
        // viewer) - reinforcing the tunnel rather than drifting independently.
        const drawStreaks = (
            list: ReturnType<typeof createStreaks>,
            cfg: TStripConfig,
            dt: number,
            w: number,
            h: number,
            brightness: number
        ) => {
            list.forEach(streak => {
                // Eases faster as it nears the viewer (rather than a flat
                // linear rate) - matching how real perspective motion
                // accelerates up close, for a more deliberate feel.
                streak.depth -= dt * 0.00024 * (0.55 + 1.1 * (1 - streak.depth));
                if (streak.depth < 0) {
                    streak.depth = 1;
                    streak.lane = (Math.random() - 0.5) * 0.8;
                }

                const near = depthVisual(Math.max(0, streak.depth - 0.05), h);
                const far = depthVisual(streak.depth, h);
                const x1 = stripX(cfg, Math.max(0, streak.depth - 0.05), w);
                const x2 = stripX(cfg, streak.depth, w);
                const y1 = lerp(near.bandTop, near.bandBottom, 0.5 + streak.lane * 0.4);
                const y2 = lerp(far.bandTop, far.bandBottom, 0.5 + streak.lane * 0.4);

                const grad = ctx.createLinearGradient(x2, y2, x1, y1);
                grad.addColorStop(0, 'transparent');
                grad.addColorStop(0.6, cfg.glow);
                grad.addColorStop(1, 'transparent');
                ctx.strokeStyle = grad;
                ctx.lineWidth = Math.max(1, 3 * near.scale);
                ctx.globalAlpha = (0.16 + 0.5 * (1 - near.eased)) * brightness;
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x1, y1);
                ctx.stroke();
            });
            ctx.globalAlpha = 1;
        };

        // The holographic financial floor: concentric foreshortened rings
        // (gold on the left half, blue on the right), a radial grid of
        // spokes that IS the "perspective grid", and a couple of light
        // pulses travelling the rings - all anchored low and center so it
        // frames the logo rather than competing with it.
        const drawFloor = (w: number, h: number, dt: number, brightness: number, rotation: number) => {
            const cx = w * 0.5;
            const cy = h * 0.83;
            const flatten = 0.26; // tighter compression - a steeper, more convincing floor angle
            const maxR = w * 0.52;
            const ringCount = 5;

            // Reflected light: two overlapping soft glows (warm/cool) rather
            // than a single flat one, so the floor reads as glossy rather
            // than a plain wash.
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const underGlowCool = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.7);
            underGlowCool.addColorStop(0, `rgba(150, 185, 255, ${0.055 * brightness})`);
            underGlowCool.addColorStop(1, 'transparent');
            ctx.fillStyle = underGlowCool;
            ctx.beginPath();
            ctx.ellipse(cx, cy, maxR * 0.7, maxR * 0.7 * flatten, 0, 0, Math.PI * 2);
            ctx.fill();

            const underGlowWarm = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.4);
            underGlowWarm.addColorStop(0, `rgba(255, 205, 140, ${0.04 * brightness})`);
            underGlowWarm.addColorStop(1, 'transparent');
            ctx.fillStyle = underGlowWarm;
            ctx.beginPath();
            ctx.ellipse(cx, cy, maxR * 0.4, maxR * 0.4 * flatten, 0, 0, Math.PI * 2);
            ctx.fill();

            // A faint echo of each wall's color bleeding onto the glossy
            // floor beneath it - not a literal mirrored candle reflection
            // (too costly for too little payoff), just enough of a color
            // cue that the floor reads as reflective rather than matte.
            if (is_hero) {
                const reflLeft = ctx.createLinearGradient(0, cy - maxR * 0.18, 0, cy + maxR * 0.05);
                reflLeft.addColorStop(0, `rgba(255, 176, 68, ${0.05 * brightness})`);
                reflLeft.addColorStop(1, 'transparent');
                ctx.fillStyle = reflLeft;
                ctx.fillRect(0, cy - maxR * 0.18, maxR * 0.6, maxR * 0.23);

                const reflRight = ctx.createLinearGradient(0, cy - maxR * 0.18, 0, cy + maxR * 0.05);
                reflRight.addColorStop(0, `rgba(76, 168, 255, ${0.05 * brightness})`);
                reflRight.addColorStop(1, 'transparent');
                ctx.fillStyle = reflRight;
                ctx.fillRect(w - maxR * 0.6, cy - maxR * 0.18, maxR * 0.6, maxR * 0.23);
            }
            ctx.restore();

            // Ring glow breathes slightly in thickness, not just alpha, so
            // the transitions feel like the floor's own light shifting
            // rather than a flat opacity fade.
            const ringLineWidth = 1.2 + 0.5 * Math.max(0, brightness - 0.85);
            if (is_travelling_floor) floor_travel = (floor_travel + dt / FLOOR_TRAVEL_MS) % 1;
            for (let i = 0; i < ringCount; i++) {
                // Where this ring currently sits between the vanishing point
                // (0) and the outer edge (1).
                const travel = is_travelling_floor ? ((i + 1) / ringCount + floor_travel) % 1 : (i + 1) / ringCount;
                const r = maxR * travel;
                // Travelling rings have to resolve out of the haze at the
                // horizon and dissolve again at the edge, or they visibly pop
                // into and out of existence at both ends of the run.
                const emerge = is_travelling_floor ? Math.sin(Math.PI * travel) : 1;
                const ringStrength = (0.22 + 0.78 * travel) * brightness * emerge;
                ctx.lineWidth = ringLineWidth;
                ctx.shadowBlur = 7;

                ctx.shadowColor = 'rgba(255, 176, 68, 0.5)';
                ctx.strokeStyle = `rgba(255, 176, 68, ${0.15 * ringStrength})`;
                ctx.beginPath();
                ctx.ellipse(cx, cy, r, r * flatten, 0, Math.PI * 0.5, Math.PI * 1.5);
                ctx.stroke();

                ctx.shadowColor = 'rgba(76, 168, 255, 0.5)';
                ctx.strokeStyle = `rgba(76, 168, 255, ${0.15 * ringStrength})`;
                ctx.beginPath();
                ctx.ellipse(cx, cy, r, r * flatten, 0, -Math.PI * 0.5, Math.PI * 0.5);
                ctx.stroke();
            }
            ctx.shadowBlur = 0;

            // Fewer, cleaner spokes converging almost to a point - a denser
            // grid reads as noise rather than structure.
            const spokeCount = 10;
            const innerR = maxR * 0.05;
            for (let k = 0; k < spokeCount; k++) {
                const angle = (k / spokeCount) * Math.PI * 2 + rotation;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                ctx.strokeStyle =
                    cos < 0 ? `rgba(255, 176, 68, ${0.06 * brightness})` : `rgba(76, 168, 255, ${0.06 * brightness})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cx + innerR * cos, cy + innerR * flatten * sin);
                ctx.lineTo(cx + maxR * cos, cy + maxR * flatten * sin);
                ctx.stroke();
            }

            // Light pulses leave a short fading trail along the ring they
            // travel - reads as a deliberate sweep of light rather than a
            // dot just teleporting around.
            floorPulses.forEach(pulse => {
                pulse.angle += dt * 0.001 * pulse.speed;
                const r = maxR * pulse.radius_frac;
                ctx.save();
                ctx.globalCompositeOperation = 'screen';
                for (let trail = 3; trail >= 0; trail--) {
                    const angle = pulse.angle - trail * 0.05;
                    const x = cx + r * Math.cos(angle);
                    const y = cy + r * flatten * Math.sin(angle);
                    const gold = Math.cos(angle) < 0;
                    const trailAlpha = 1 - trail / 4;
                    ctx.fillStyle = gold
                        ? `rgba(255, 210, 140, ${0.9 * trailAlpha})`
                        : `rgba(160, 210, 255, ${0.9 * trailAlpha})`;
                    ctx.shadowColor = gold ? 'rgba(255, 176, 68, 0.8)' : 'rgba(76, 168, 255, 0.8)';
                    ctx.shadowBlur = 10 * trailAlpha;
                    ctx.beginPath();
                    ctx.arc(x, y, 2.2 * (0.6 + trailAlpha * 0.4), 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            });
        };

        const drawParticles = (
            dt: number,
            w: number,
            h: number,
            brightness: number,
            light_ref: { cx: number; cy: number; radius: number; intensity: number }
        ) => {
            particles.forEach(p => {
                p.x += p.vx * (dt / 1000);
                p.y += p.vy * (dt / 1000);
                if (p.x < -0.05) p.x = 1.05;
                if (p.x > 1.05) p.x = -0.05;
                if (p.y < -0.05) p.y = 1.05;

                const px = p.x * w;
                const py = p.y * h;
                const distToLight = Math.hypot(px - light_ref.cx, py - light_ref.cy);
                const lightBoost = Math.max(0, 1 - distToLight / light_ref.radius) * light_ref.intensity;

                const size = (1 + p.z * 2.4) * (1 + lightBoost * 0.6);
                const alpha = (0.15 + p.z * 0.55) * brightness + lightBoost * 0.25;
                ctx.globalAlpha = Math.min(1, alpha);
                ctx.fillStyle = p.gold ? 'rgba(255, 176, 68, 1)' : 'rgba(76, 168, 255, 1)';
                ctx.shadowColor = p.gold ? 'rgba(255, 176, 68, 0.8)' : 'rgba(76, 168, 255, 0.8)';
                // Less bloom for the hero variant - crisper points of light
                // read as instrument-grade data, less as game sparkle.
                ctx.shadowBlur = (is_hero ? 4 : 6) * p.z;
                ctx.beginPath();
                ctx.arc(px, py, size, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        };

        const tick = (now: number) => {
            const dt = Math.min(64, now - last_time);
            last_time = now;
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            const energy_now = energy_ref.current;

            // A slow, irregular "breathing" signal (sum of a few
            // incommensurate sine waves, not a single fixed-period loop) plus
            // an energy-driven boost - drives both the canvas layers below
            // and (via a CSS var written on the target scene wrapper, if
            // any) the ambient glow blobs that live outside the canvas.
            const breathe =
                0.85 +
                0.1 * Math.sin(now / 4300) +
                0.06 * Math.sin(now / 11700 + 1.3) +
                0.05 * Math.sin(now / 2600 + 0.7);
            const brightness = Math.min(1.25, Math.max(0.6, breathe)) * (0.85 + energy_now * 0.3);

            cssVarThrottle += dt;
            if (scene_el && cssVarThrottle > 80) {
                cssVarThrottle = 0;
                scene_el.style.setProperty('--mw-ambient', breathe.toFixed(3));
                scene_el.style.setProperty('--mw-progress', energy_now.toFixed(3));
            }

            ctx.clearRect(0, 0, w, h);

            // Back-to-front: atmosphere and floor first, then the logo's own
            // (deliberately contained) light, then the candle walls and
            // everything travelling through the scene in front of them.
            drawVolumetricLight(w, h, brightness);
            drawWallTint(w, h, brightness);
            drawFloor(w, h, dt, brightness, now / 90000);
            // Kept modest (small radius, restrained intensity) on purpose -
            // the area directly behind the logo should stay the darkest part
            // of the scene so the logo (and the nearby walls/floor) read as
            // the brightest, per the intended contrast hierarchy.
            const light_ref = drawLogoLight(w, h, Math.min(w, h) * 0.3, 0.2 + energy_now * 0.35);

            strips.forEach(entry => entry.strip.update(now, dt, energy_now));
            strips.forEach(entry => drawStrip(entry, w, h, brightness));

            drawStreaks(streaksLeft, strips[0].cfg, dt, w, h, brightness);
            drawStreaks(streaksRight, strips[1].cfg, dt, w, h, brightness);
            drawParticles(dt, w, h, brightness, light_ref);
            if (is_hero) drawDepthFog(w, h, brightness);

            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        };
    }, [ambientTargetSelector, is_hero]);

    return <canvas ref={canvas_ref} className={className} aria-hidden='true' />;
};

export default MarketSceneCanvas;
