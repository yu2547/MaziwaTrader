import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from '@deriv-com/translations';
import { AreaChartIcon, CloseIcon } from './icons';

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

// The time marks along the foot, and the vertical rules standing on them.
const TIME_MARKS = 5;

// The steps a price axis is allowed to land on, so its labels read 946.00 and
// 947.00 the way the reference's do, rather than whatever the window's own
// high and low happen to divide into.
const NICE_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

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
    /**
     * The contract this page has open, when it has one. Everything in it is
     * Deriv's own figure for that contract, restated on every tick: where it
     * was entered, the band it is inside now, and what it is making. Given it,
     * the chart draws the reference's running state - the entry marked on the
     * line it was taken at, the band in the colour a live contract wears, and
     * the profit beside the spot - in place of the quote's flat band.
     */
    contract?: {
        barriers: { high: number; low: number } | null;
        /** The contract's own currency, which is what its profit is in. */
        currency: string;
        entry: { epoch: number; price: number } | null;
        profit: number | null;
    } | null;
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

const PriceChart = ({
    band_distance = null,
    barriers = null,
    contract = null,
    decimals,
    epochs = [],
    prices,
}: TPriceChartProps) => {
    const { localize } = useTranslations();
    const box = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ height: 0, width: 0 });
    const [is_types_open, setIsTypesOpen] = useState(false);

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
        // levels are drawn where they were set. An open contract's own band
        // outranks both: it is the one the money is actually inside.
        const band_levels =
            contract?.barriers ??
            (band_distance ? { high: spot + band_distance, low: spot - band_distance } : barriers);

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

        // Round prices, a step at a time, rather than the window's own corners.
        const rough = (top - bottom) / GRID_LINES;
        const step = NICE_STEPS.find(candidate => candidate >= rough) ?? NICE_STEPS[NICE_STEPS.length - 1];
        const first = Math.ceil(bottom / step) * step;
        const grid: { label: string; y: number }[] = [];
        for (let price = first; price <= top; price += step) {
            grid.push({ label: price.toFixed(decimals), y: y(price) });
        }

        // Evenly spaced along the foot, each with its own rule standing on it.
        const times = shown_epochs.length === shown.length;
        const ticks = times
            ? Array.from({ length: TIME_MARKS }, (_, mark) => {
                  const index = Math.round((mark / (TIME_MARKS - 1)) * (shown.length - 1));
                  return { label: timeLabel(shown_epochs[index]), x: x(index) };
              })
            : [];

        // Each line carries how far it sits from the spot, signed, the way the
        // reference labels them - to one place finer than the market's own
        // prices, which is how it reads +0.360 on a market quoted to 946.22.
        const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(decimals + 1)}`;
        const band = band_levels
            ? {
                  high: { label: signed(band_levels.high - spot), y: y(band_levels.high) },
                  low: { label: signed(band_levels.low - spot), y: y(band_levels.low) },
              }
            : null;

        // Where the contract was entered, on this chart's own ticks: the first
        // one at or after the entry time. An entry older than the window shows
        // at the left edge, which is where it is - off the left of what is
        // drawn - rather than not at all.
        let entry = null;
        if (contract?.entry && times) {
            const index = shown_epochs.findIndex(epoch => epoch >= contract.entry!.epoch);
            entry = { x: x(index === -1 ? shown.length - 1 : Math.max(0, index)), y: y(contract.entry.price) };
        }

        return {
            area,
            band,
            entry,
            grid,
            last: { price: spot, x: x(shown.length - 1), y: y(spot) },
            // The tick the band is measured from, which the reference marks
            // with its own dotted line just off the current one.
            previous: shown.length > 1 ? y(shown[shown.length - 2]) : null,
            line,
            plot_height,
            plot_width,
            rising: spot >= shown[0],
            ticks,
        };
    }, [band_distance, barriers, contract, decimals, shown, shown_epochs, size]);

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
                        {/* Sampled down the reference's own frame: its ground
                            is #181c25 and the pixel under the line is #2f323b,
                            which is white at a tenth over it - a wash you can
                            just see, not the grey mass a heavier fill draws. */}
                        <linearGradient id='mw-dt-fill' x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='0%' stopColor='currentColor' stopOpacity='0.1' />
                            <stop offset='100%' stopColor='currentColor' stopOpacity='0.01' />
                        </linearGradient>

                        {/* The price tag sits off the page rather than on it,
                            the way the reference lifts it off the chart. */}
                        <filter id='mw-dt-badge-shadow' x='-30%' y='-60%' width='170%' height='240%'>
                            <feDropShadow dx='0' dy='1' stdDeviation='2' floodColor='#000' floodOpacity='0.45' />
                        </filter>
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

                    {drawing.ticks.map((tick, index) => (
                        <g key={tick.label}>
                            <line
                                className='mw-dt__chart-grid'
                                x1={tick.x}
                                x2={tick.x}
                                y1='0'
                                y2={drawing.plot_height}
                            />
                            <text
                                className='mw-dt__chart-axis'
                                x={tick.x}
                                y={size.height - 6}
                                textAnchor={index === 0 ? 'start' : 'middle'}
                            >
                                {tick.label}
                            </text>
                        </g>
                    ))}

                    {/* The stretch the market has not reached yet is left as
                        it is: sampled either side of the spot on the
                        reference's own frame, its ground is #181c25 in both
                        places. The wash that used to stand there drew a pale
                        block down the right of the chart that the reference
                        has no trace of. */}
                    <path className='mw-dt__chart-area' d={drawing.area} fill='url(#mw-dt-fill)' />
                    <path className='mw-dt__chart-line' d={drawing.line} />

                    {/* The band, running from the spot to the right edge with
                        its distance above each line - the contract's room to
                        move, as the reference draws it. */}
                    {drawing.band && (
                        <g className={`mw-dt__chart-band${contract ? ' mw-dt__chart-band--live' : ''}`}>
                            {/* The room between the two lines, tinted, and the
                                tick they are measured from - the reference's
                                dotted line just off the current price. */}
                            <rect
                                className='mw-dt__chart-band-fill'
                                x={drawing.last.x}
                                y={drawing.band.high.y}
                                width={Math.max(0, drawing.plot_width - drawing.last.x)}
                                height={Math.max(0, drawing.band.low.y - drawing.band.high.y)}
                            />
                            {drawing.previous !== null && (
                                <line
                                    className='mw-dt__chart-band-spot'
                                    x1={drawing.last.x}
                                    x2={drawing.plot_width}
                                    y1={drawing.previous}
                                    y2={drawing.previous}
                                />
                            )}

                            {[drawing.band.high, drawing.band.low].map((edge, index) => (
                                <g key={edge.label}>
                                    <line
                                        className='mw-dt__chart-barrier'
                                        x1={drawing.last.x}
                                        x2={drawing.plot_width}
                                        y1={edge.y}
                                        y2={edge.y}
                                    />
                                    {/* The arrow head the reference puts where
                                        each line starts. */}
                                    <path
                                        className='mw-dt__chart-barrier-head'
                                        d={
                                            index === 0
                                                ? `M${drawing.last.x},${edge.y} l9,0 l0,7 z`
                                                : `M${drawing.last.x},${edge.y} l9,0 l0,-7 z`
                                        }
                                    />
                                    <text
                                        className='mw-dt__chart-barrier-label'
                                        x={drawing.plot_width}
                                        y={index === 0 ? edge.y - 7 : edge.y + 15}
                                        textAnchor='end'
                                    >
                                        {edge.label}
                                    </text>
                                </g>
                            ))}
                        </g>
                    )}

                    {/* Where the contract was taken: the reference's dashed
                        line standing on that tick, the pin hanging over it and
                        the ring around the tick itself. */}
                    {drawing.entry && (
                        <g className='mw-dt__chart-entry'>
                            <line
                                className='mw-dt__chart-entry-line'
                                x1={drawing.entry.x}
                                x2={drawing.entry.x}
                                y1='0'
                                y2={drawing.plot_height}
                            />
                            {/* The pin, drawn where it is rather than at the
                                origin: a teardrop with a hole in it, sitting on
                                the tick with its point on the price. */}
                            <path
                                className='mw-dt__chart-entry-pin'
                                transform={`translate(${drawing.entry.x - 7}, ${drawing.entry.y - 22})`}
                                d='M7 22C7 22 14 13.2 14 7.6A7 7 0 0 0 0 7.6C0 13.2 7 22 7 22Z'
                            />
                            <circle
                                className='mw-dt__chart-entry-eye'
                                cx={drawing.entry.x}
                                cy={drawing.entry.y - 14.5}
                                r='2.6'
                            />
                            <circle
                                className='mw-dt__chart-entry-spot'
                                cx={drawing.entry.x}
                                cy={drawing.entry.y}
                                r='4'
                            />
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
                    {/* The tick itself, with a ring of the page's own ground
                        around it so it reads as a point on the line rather
                        than a blob drawn over it. */}
                    <circle className='mw-dt__chart-dot-ring' cx={drawing.last.x} cy={drawing.last.y} r='5.5' />
                    <circle className='mw-dt__chart-dot' cx={drawing.last.x} cy={drawing.last.y} r='3.5' />

                    {/* What the contract is making, beside the tick it is
                        making it on - Deriv's own running figure, in the colour
                        of the side it has gone. */}
                    {contract && contract.profit !== null && (
                        <text
                            className={`mw-dt__chart-profit${contract.profit < 0 ? ' mw-dt__chart-profit--down' : ''}`}
                            x={drawing.last.x + 11}
                            y={drawing.last.y + 5}
                        >
                            {`${contract.profit >= 0 ? '+' : '-'}${Math.abs(contract.profit).toFixed(2)}`}
                            <tspan className='mw-dt__chart-profit-unit'>{` ${contract.currency}`}</tspan>
                        </text>
                    )}
                    <rect
                        className={`mw-dt__chart-badge${drawing.rising ? '' : ' mw-dt__chart-badge--down'}`}
                        x={drawing.plot_width + 2}
                        y={drawing.last.y - 11}
                        width={RIGHT_GUTTER - 4}
                        height='22'
                        rx='5'
                        filter='url(#mw-dt-badge-shadow)'
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

            {/* What the chart is drawing, in the corner the reference keeps it
                in: one tick per point, as an area. */}
            <button
                type='button'
                className='mw-dt__chart-kind'
                aria-label={localize('Chart types')}
                aria-expanded={is_types_open}
                onClick={() => setIsTypesOpen(true)}
            >
                <i>{localize('1 T')}</i>
                <AreaChartIcon />
            </button>

            {is_types_open &&
                createPortal(
                    <div className='mw-dt__sheet'>
                        <button
                            type='button'
                            className='mw-dt__sheet-scrim'
                            aria-label={localize('Close')}
                            tabIndex={-1}
                            onClick={() => setIsTypesOpen(false)}
                        />
                        <div
                            className='mw-dt__kinds'
                            role='dialog'
                            aria-modal='true'
                            aria-label={localize('Chart types')}
                        >
                            <header className='mw-dt__kinds-head'>
                                <h2>{localize('Chart types')}</h2>
                                <button
                                    type='button'
                                    aria-label={localize('Close')}
                                    onClick={() => setIsTypesOpen(false)}
                                >
                                    <CloseIcon className='mw-dt__close-icon' />
                                </button>
                            </header>

                            {/* This chart draws the tick stream as an area, and
                                that is the whole of what it draws - candles
                                would need a different feed than the one this
                                page reads. The rest are shown as the reference
                                shows them for this trade type: present, and not
                                available. */}
                            <div className='mw-dt__kinds-row'>
                                {[
                                    { available: true, label: localize('Area') },
                                    { available: false, label: localize('Hollow') },
                                    { available: false, label: localize('OHLC') },
                                ].map(kind => (
                                    <span
                                        key={kind.label}
                                        className={`mw-dt__kind${kind.available ? ' mw-dt__kind--on' : ''}`}
                                        aria-disabled={!kind.available}
                                    >
                                        {kind.label}
                                    </span>
                                ))}
                            </div>

                            <h3 className='mw-dt__kinds-title'>{localize('Time interval')}</h3>
                            <p className='mw-dt__kinds-note'>
                                {localize('Tick interval only available for "Area" chart type.')}
                            </p>

                            <div className='mw-dt__kinds-grid'>
                                {[
                                    { available: true, label: localize('1 tick') },
                                    { available: false, label: localize('1 minute') },
                                    { available: false, label: localize('2 minutes') },
                                    { available: false, label: localize('3 minutes') },
                                    { available: false, label: localize('5 minutes') },
                                    { available: false, label: localize('10 minutes') },
                                    { available: false, label: localize('15 minutes') },
                                    { available: false, label: localize('30 minutes') },
                                    { available: false, label: localize('1 hour') },
                                    { available: false, label: localize('2 hours') },
                                    { available: false, label: localize('4 hours') },
                                    { available: false, label: localize('8 hours') },
                                    { available: false, label: localize('1 day') },
                                ].map(interval => (
                                    <span
                                        key={interval.label}
                                        className={`mw-dt__kind${interval.available ? ' mw-dt__kind--on' : ''}`}
                                        aria-disabled={!interval.available}
                                    >
                                        {interval.label}
                                    </span>
                                ))}
                            </div>

                            <p className='mw-dt__kinds-foot'>
                                {localize('Only selected charts and time intervals are available for this trade type.')}
                            </p>
                        </div>
                    </div>,
                    document.body
                )}
        </div>
    );
};

export default PriceChart;
