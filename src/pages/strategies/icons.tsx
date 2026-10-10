/**
 * The four marks on the strategy cards.
 *
 * Drawn rather than typed, for the same reason the Trading Bots tabs are (see
 * ../trading-bots/icons): an emoji carries its own palette, and these have to
 * take the card's accent colour on the resting face and keep it when the card
 * turns to the gradient underneath. Each is stroked in currentColor, so one
 * rule on the card sets the glyph.
 */
type TIconProps = { className?: string };

const base = {
    'aria-hidden': 'true' as const,
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: '1.8',
    viewBox: '0 0 24 24',
    xmlns: 'http://www.w3.org/2000/svg',
};

/** A line stepping up to an arrowhead: over, and under. */
export const OverUnderIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base}>
        <path d='M3 17.5 8.5 12l3.5 3.5L20 7' />
        <path d='M15.5 7H20v4.5' />
    </svg>
);

/** A single bar: one, and odd. */
export const OddIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base}>
        <rect x='3.25' y='3.25' width='17.5' height='17.5' rx='4.5' />
        <path d='M8 12h8' />
    </svg>
);

/** A pair of bars: two, and even. */
export const EvenIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base}>
        <rect x='3.25' y='3.25' width='17.5' height='17.5' rx='4.5' />
        <path d='M8 9.5h8M8 14.5h8' />
    </svg>
);

/** Straight up and out again. */
export const HitAndRunIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base}>
        <path d='M12 20V5' />
        <path d='M5.5 11.5 12 5l6.5 6.5' />
    </svg>
);
