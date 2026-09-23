/**
 * The small marks this page uses, drawn as icons rather than typed as
 * characters.
 *
 * They were "i", "↑", "›", "−" and "+" set in the page font, which is why the
 * ticket read as a sketch of itself: a glyph's weight, size and baseline are
 * the typeface's business, not the design's, so nothing lined up with anything
 * and every mark sat slightly off its row. These are on one 24-unit grid with
 * one stroke weight, sized by font-size wherever they are used, so a mark is
 * the same mark in the stats row, the ticket and the chart.
 */
type TIconProps = { className?: string };

const base = {
    'aria-hidden': true,
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    viewBox: '0 0 24 24',
    xmlns: 'http://www.w3.org/2000/svg',
} as const;

export const InfoIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='1.6'>
        <circle cx='12' cy='12' r='9' />
        <path d='M12 11v5.5' />
        <circle cx='12' cy='7.8' r='0.9' fill='currentColor' stroke='none' />
    </svg>
);

export const ChevronRightIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='2'>
        <path d='M9.5 5.5l6.5 6.5-6.5 6.5' />
    </svg>
);

export const ArrowUpIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='1.8'>
        <path d='M12 19.5V5.5M6 11.5l6-6 6 6' />
    </svg>
);

/**
 * Wider and heavier than a chevron or a mark: on the reference these two are
 * the largest things on the stake row, a thick bar either side of the figure,
 * not a pair of small signs.
 */
export const MinusIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='2.4'>
        <path d='M4 12h16' />
    </svg>
);

export const PlusIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='2.4'>
        <path d='M12 4v16M4 12h16' />
    </svg>
);

/** The caret on the market card, which turns over while its list is open. */
export const ChevronDownIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='2'>
        <path d='M5.5 9.5l6.5 6.5 6.5-6.5' />
    </svg>
);

/**
 * The way the market has moved since the tick before it. Solid, and the only
 * coloured thing on that line - the reference leaves the figures beside it in
 * the card's own grey.
 */
export const TrendIcon = ({ className, is_up }: TIconProps & { is_up: boolean }) => (
    <svg className={className} {...base}>
        <path d={is_up ? 'M12 6l7 12H5z' : 'M12 18L5 6h14z'} fill='currentColor' stroke='none' />
    </svg>
);

/** What closes a sheet, in place of the multiplication sign it was set in. */
export const CloseIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='2'>
        <path d='M6 6l12 12M18 6L6 18' />
    </svg>
);

/** The chart this page draws: a filled area under a line. */
export const AreaChartIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='1.7'>
        <path d='M3 16.5l5-5.5 4 3 5-7.5 4 4.5' />
        <path d='M3 16.5l5-5.5 4 3 5-7.5 4 4.5V20H3z' fill='currentColor' stroke='none' opacity='0.18' />
    </svg>
);
