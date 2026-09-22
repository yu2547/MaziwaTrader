import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from '@deriv-com/translations';

/**
 * The market, drawn from the ticks this page is already receiving.
 *
 * It used to be SmartCharts, which needs the classic socket and its own
 * active_symbols round trip, and sat on "Retrieving Market Symbols..."
 * indefinitely when either did not arrive - a trade panel quoting live prices
 * beside a chart that never loaded. This draws the same tick stream that feeds
 * the spot, the digit strip and the quote, so if the price is moving up there,
 * it is moving in here.
 *
 * Every point is a tick Deriv sent. Nothing is smoothed, interpolated or
 * filled in: a gap in the feed is a gap on the line.
 */

// Deriv's own chart shows a couple of hundred ticks at this zoom; more than
// this and each tick is narrower than the line drawn for it.
const VISIBLE_TICKS = 180;
const GRID_LINES = 4;
const RIGHT_GUTTER = 62;
const BOTTOM_GUTTER = 22;

// The room the reference leaves to the right of the spot for a contract's band
// to run into. Only taken when there is a band to draw: without one the ticks
// use the full width, exactly as before.
const FUTURE_FRACTION = 0.22;

type TPriceChartProps = {
    /**
     * The band as a distance either side of the spot, for the contracts that
     * state it that way - an accumulator's "± 0.03797%". Hung on the last tick
     * drawn here, so the two lines sit on the market rather than on a price
     * from whichever render worked the distance out.
     */
    band_distance?: number | null;
    /**
     * The band as two price levels, when Deriv gives them outright. Drawn from
     * the spot to the right edge, as the reference draws them, and folded into
     * the vertical range so they are on screen rather than off the top of it.
     */
    barriers?: { high: number; low: number } | null;
    decimals: number;
    /** Epoch seconds for the ticks, when the feed gave them. */
    epochs?: number[];
    prices: number[];
};

const timeLabel = (epoch: number) => {
    const date = new Date(epoch * 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
};

const PriceChart = ({ band_distance = null, barriers = null, decimals, epochs = [], prices }: TPriceChartProps) => {
    const { localize } = useTranslations();
    const box = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ height: 0, width: 0 });

    // Drawn in real pixels rather than a scaled viewBox, so the labels stay
    // the size they were written at whatever shape the panel is.
    useEffect(() => {
        const element = box.current;
        if (!element) return undefined;
        const observer = new ResizeObserver(entries => {
            const rect = entries[0]?.contentRect;
            if (rect) setSize({ height: rect.height, width: rect.width });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const shown = useMemo(() => prices.slice(-VISIBLE_TICKS), [prices]);
    const shown_epochs = useMemo(() => epochs.slice(-VISIBLE_TICKS), [epochs]);

    const drawing = useMemo(() => {
        const { height, width } = size;
        if (shown.length < 2 || width < 40 || height < 40) return null;

        const spot = shown[shown.length - 1];
        // A band measured against each tick is hung on this chart's own last
        // one, which is what keeps it centred on the market as it moves. Fixed
        // levels are drawn where they were set.
        const band_levels = band_distance ? { high: spot + band_distance, low: spot - band_distance } : barriers;

        const plot_width = Math.max(10, width - RIGHT_GUTTER);
        const plot_height = Math.max(10, height - BOTTOM_GUTTER);
        // The band counts towards the range, so a barrier just outside the
        // ticks' own high and low is still drawn on screen.
        const high = Math.max(...shown, ...(band_levels ? [band_levels.high] : []));
        const low = Math.min(...shown, ...(band_levels ? [band_levels.low] : []));
        // A flat stretch would otherwise divide by zero and draw nothing.
        const span = high - low || Math.max(10 ** -decimals, high * 1e-6);
        const pad = span * 0.12;
        const top = high + pad;
        const bottom = low - pad;

        const ticks_width = band_levels ? plot_width * (1 - FUTURE_FRACTION) : plot_width;
        const x = (index: number) => (index / (shown.length - 1)) * ticks_width;
        const y = (price: number) => plot_height - ((price - bottom) / (top - bottom)) * plot_height;

        const line = shown.map((price, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(price)}`).join(' ');
        const area = `${line} L${ticks_width},${plot_height} L0,${plot_height} Z`;

        const grid = Array.from({ length: GRID_LINES + 1 }, (_, index) => {
            const price = bottom + ((top - bottom) * index) / GRID_LINES;
            return { label: price.toFixed(decimals), y: y(price) };
        });

        const times = shown_epochs.length === shown.length;
        const ticks = times
            ? [0, Math.floor(shown.length / 2), shown.length - 1].map(index => ({
                  label: timeLabel(shown_epochs[index]),
                  x: x(index),
              }))
            : [];

        // Each line carries how far it sits from the spot, signed, the way the
        // reference labels them.
        const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;
        const band = band_levels
            ? {
                  high: { label: signed(band_levels.high - spot), y: y(band_levels.high) },
                  low: { label: signed(band_levels.low - spot), y: y(band_levels.low) },
              }
            : null;

        return {
            area,
            band,
            future: band_levels ? { width: plot_width - ticks_width, x: ticks_width } : null,
            grid,
            last: { price: spot, x: x(shown.length - 1), y: y(spot) },
            line,
            plot_height,
            plot_width,
            rising: spot >= shown[0],
            ticks,
        };
    }, [band_distance, barriers, decimals, shown, shown_epochs, size]);

    return (
        <div className='mw-dt__chart' ref={box}>
            {!drawing && <p className='mw-dt__chart-waiting'>{localize('Waiting for ticks...')}</p>}
            {drawing && (
                <svg
                    className='mw-dt__chart-svg'
                    width={size.width}
                    height={size.height}
                    role='img'
                    aria-label={localize('Price chart')}
                >
                    <defs>
                        {/* Measured off the reference, which fades but never
                            reaches the page: at 0.32 down to 0.08 of the line's
                            own grey, the fill reads #e2e2e2 where the reference
                            reads #e0e0e0 and #f0f0f0 where it reads #f1f1f1. */}
                        <linearGradient id='mw-dt-fill' x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='0%' stopColor='currentColor' stopOpacity='0.32' />
                            <stop offset='100%' stopColor='currentColor' stopOpacity='0.08' />
                        </linearGradient>
                    </defs>

                    {drawing.grid.map(line => (
                        <g key={line.label}>
                            <line
                                className='mw-dt__chart-grid'
                                x1='0'
                                x2={drawing.plot_width}
                                y1={line.y}
                                y2={line.y}
                            />
                            <text className='mw-dt__chart-axis' x={drawing.plot_width + 6} y={line.y + 4}>
                                {line.label}
                            </text>
                        </g>
                    ))}

                    {drawing.ticks.map(tick => (
                        <text
                            key={tick.label}
                            className='mw-dt__chart-axis'
                            x={tick.x}
                            y={size.height - 6}
                            textAnchor='middle'
                        >
                            {tick.label}
                        </text>
                    ))}

                    {/* The stretch the market has not reached yet, shaded the
                        way the reference shades it. */}
                    {drawing.future && (
                        <rect
                            className='mw-dt__chart-future'
                            x={drawing.future.x}
                            y='0'
                            width={drawing.future.width}
                            height={drawing.plot_height}
                        />
                    )}

                    <path className='mw-dt__chart-area' d={drawing.area} fill='url(#mw-dt-fill)' />
                    <path className='mw-dt__chart-line' d={drawing.line} />

                    {/* The band, running from the spot to the right edge with
                        its distance above each line - the contract's room to
                        move, as the reference draws it. */}
                    {drawing.band && (
                        <g className='mw-dt__chart-band'>
                            <line
                                className='mw-dt__chart-barrier'
                                x1={drawing.last.x}
                                x2={drawing.plot_width}
                                y1={drawing.band.high.y}
                                y2={drawing.band.high.y}
                            />
                            <text
                                className='mw-dt__chart-barrier-label'
                                x={drawing.plot_width}
                                y={drawing.band.high.y - 6}
                                textAnchor='end'
                            >
                                {drawing.band.high.label}
                            </text>
                            <line
                                className='mw-dt__chart-barrier'
                                x1={drawing.last.x}
                                x2={drawing.plot_width}
                                y1={drawing.band.low.y}
                                y2={drawing.band.low.y}
                            />
                            <text
                                className='mw-dt__chart-barrier-label'
                                x={drawing.plot_width}
                                y={drawing.band.low.y + 14}
                                textAnchor='end'
                            >
                                {drawing.band.low.label}
                            </text>
                        </g>
                    )}

                    {/* Where the market is now: the dot on the last tick, the
                        dashed line across to it, and Deriv's price beside it. */}
                    <line
                        className='mw-dt__chart-now'
                        x1='0'
                        x2={drawing.plot_width}
                        y1={drawing.last.y}
                        y2={drawing.last.y}
                    />
                    <circle className='mw-dt__chart-dot' cx={drawing.last.x} cy={drawing.last.y} r='3.5' />
                    <rect
                        className={`mw-dt__chart-badge${drawing.rising ? '' : ' mw-dt__chart-badge--down'}`}
                        x={drawing.plot_width + 2}
                        y={drawing.last.y - 10}
                        width={RIGHT_GUTTER - 4}
                        height='20'
                        rx='4'
                    />
                    <text
                        className='mw-dt__chart-badge-text'
                        x={drawing.plot_width + RIGHT_GUTTER / 2}
                        y={drawing.last.y + 4}
                        textAnchor='middle'
                    >
                        {drawing.last.price.toFixed(decimals)}
                    </text>
                </svg>
            )}
        </div>
    );
};

export default PriceChart;
