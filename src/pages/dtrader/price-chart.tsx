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

type TPriceChartProps = {
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

const PriceChart = ({ decimals, epochs = [], prices }: TPriceChartProps) => {
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

        const plot_width = Math.max(10, width - RIGHT_GUTTER);
        const plot_height = Math.max(10, height - BOTTOM_GUTTER);
        const high = Math.max(...shown);
        const low = Math.min(...shown);
        // A flat stretch would otherwise divide by zero and draw nothing.
        const span = high - low || Math.max(10 ** -decimals, high * 1e-6);
        const pad = span * 0.12;
        const top = high + pad;
        const bottom = low - pad;

        const x = (index: number) => (index / (shown.length - 1)) * plot_width;
        const y = (price: number) => plot_height - ((price - bottom) / (top - bottom)) * plot_height;

        const line = shown.map((price, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(price)}`).join(' ');
        const area = `${line} L${plot_width},${plot_height} L0,${plot_height} Z`;

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

        return {
            area,
            grid,
            last: { price: shown[shown.length - 1], x: x(shown.length - 1), y: y(shown[shown.length - 1]) },
            line,
            plot_height,
            plot_width,
            rising: shown[shown.length - 1] >= shown[0],
            ticks,
        };
    }, [decimals, shown, shown_epochs, size]);

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
                        <linearGradient id='mw-dt-fill' x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='0%' stopColor='currentColor' stopOpacity='0.18' />
                            <stop offset='100%' stopColor='currentColor' stopOpacity='0' />
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

                    <path className='mw-dt__chart-area' d={drawing.area} fill='url(#mw-dt-fill)' />
                    <path className='mw-dt__chart-line' d={drawing.line} />

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
