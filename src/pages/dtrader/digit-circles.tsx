/**
 * The 0-9 ring strip Deriv shows under the chart on the digit contracts.
 *
 * Each digit is a ring carrying how often it came up over the tick window this
 * page already holds, with an arc across the foot of the ring on the two that
 * are leading the window and the two that are trailing it, the digit the
 * latest tick ended on marked underneath, and the digit the ticket is
 * predicting filled in.
 *
 * The percentages describe the ticks that have been. They say nothing about
 * the next one, and nothing here is smoothed or filled in: an empty window
 * reads as an empty window.
 */

const RADIUS = 17;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// A quarter of the ring, centred on its foot - the mark, not a gauge.
const ARC = CIRCUMFERENCE / 4;

type TStanding = 'high' | 'high-2' | 'low' | 'low-2';

/**
 * Which digits lead and trail the window. Taken by order rather than by
 * threshold so there is always exactly one of each, and the marks land on
 * distinct digits when several share a percentage.
 */
const standings = (distribution: number[]) => {
    const marks = new Map<number, TStanding>();
    if (distribution.every(pct => pct === 0)) return marks;

    const order = distribution.map((pct, digit) => ({ digit, pct })).sort((a, b) => b.pct - a.pct);
    const set = (index: number, standing: TStanding) => {
        const item = order[index];
        if (item && !marks.has(item.digit)) marks.set(item.digit, standing);
    };
    set(order.length - 1, 'low');
    set(order.length - 2, 'low-2');
    set(1, 'high-2');
    set(0, 'high');
    return marks;
};

type TDigitCirclesProps = {
    /** How often each digit came up, as a percentage of the window. */
    distribution: number[];
    /** The digit the latest tick ended on, marked the way Deriv marks it. */
    latest: number | null;
    /** The digit the ticket is predicting, when it is on a contract that takes one. */
    selected?: number;
};

const DigitCircles = ({ distribution, latest, selected }: TDigitCirclesProps) => {
    const marks = standings(distribution);

    return (
        <div className='mw-dt__digits'>
            {distribution.map((pct, digit) => {
                const standing = marks.get(digit);
                const classes = [
                    'mw-dt__digit',
                    digit === selected ? 'mw-dt__digit--on' : '',
                    digit === latest ? 'mw-dt__digit--now' : '',
                ]
                    .filter(Boolean)
                    .join(' ');

                return (
                    <span key={digit} className={classes}>
                        <svg className='mw-dt__digit-ring' viewBox='0 0 40 40' aria-hidden='true'>
                            <circle className='mw-dt__digit-track' cx='20' cy='20' r={RADIUS} />
                            {standing && (
                                <circle
                                    className={`mw-dt__digit-arc mw-dt__digit-arc--${standing}`}
                                    cx='20'
                                    cy='20'
                                    r={RADIUS}
                                    /* Rotated so the dash starts at the foot of
                                       the ring, then pulled back half its own
                                       length so it sits centred on it. */
                                    transform='rotate(90 20 20)'
                                    strokeDasharray={`${ARC} ${CIRCUMFERENCE}`}
                                    strokeDashoffset={ARC / 2}
                                />
                            )}
                        </svg>
                        <b>{digit}</b>
                        <i>{`${pct.toFixed(1)}%`}</i>
                        {digit === latest && <em className='mw-dt__digit-mark' aria-hidden='true' />}
                    </span>
                );
            })}
        </div>
    );
};

export default DigitCircles;
