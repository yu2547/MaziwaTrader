/**
 * The small glyph beside each trade type, drawn here rather than pulled from an
 * icon package so it takes the colour of the text it sits next to and stays
 * legible at the 1.6rem the list and the ticket header use.
 */

type TTradeIconProps = { id: string };

const TradeIcon = ({ id }: TTradeIconProps) => {
    const common = {
        'aria-hidden': true as const,
        className: 'mw-dt__glyph',
        viewBox: '0 0 18 18',
        xmlns: 'http://www.w3.org/2000/svg',
    };

    switch (id) {
        // The digit family: the pips of a die, which is how Deriv marks them.
        case 'even_odd':
        case 'matches_differs':
        case 'over_under':
            return (
                <svg {...common}>
                    <rect x='2' y='2' width='14' height='14' rx='3' />
                    <circle cx='6.5' cy='6.5' r='1.4' className='mw-dt__glyph-dot' />
                    <circle cx='11.5' cy='11.5' r='1.4' className='mw-dt__glyph-dot' />
                </svg>
            );
        case 'accumulators':
            return (
                <svg {...common}>
                    <path d='M2 14l3.5-3.5L8.5 13 12 6l4 4' />
                </svg>
            );
        case 'multipliers':
            return (
                <svg {...common}>
                    <path d='M4 4l10 10M14 4L4 14' />
                </svg>
            );
        case 'turbos':
            return (
                <svg {...common}>
                    <path d='M2 15L8 7l2.5 3L16 3' />
                    <path d='M11.5 3H16v4.5' />
                </svg>
            );
        case 'vanillas':
            return (
                <svg {...common}>
                    <path d='M2 13c4.5 0 4-9 7.5-9S14 9 16 9' />
                </svg>
            );
        case 'touch_no_touch':
            return (
                <svg {...common}>
                    <path d='M2 6h14' className='mw-dt__glyph-dash' />
                    <path d='M2 15c4 0 5.5-9 9-9' />
                </svg>
            );
        case 'higher_lower':
            return (
                <svg {...common}>
                    <path d='M2 10h14' className='mw-dt__glyph-dash' />
                    <path d='M9 15V4M6 7l3-3 3 3' />
                </svg>
            );
        // Rise/Fall, and anything added later: the two directions.
        default:
            return (
                <svg {...common}>
                    <path d='M2 12l4.5-4.5L9.5 10 16 3' />
                    <path d='M11.5 3H16v4.5' />
                </svg>
            );
    }
};

export default TradeIcon;
