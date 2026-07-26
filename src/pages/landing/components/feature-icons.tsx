// Small self-contained line icons (no icon-library dependency) - each is a
// single, simple stroke SVG so the feature cards don't need to guess at
// exact icon names/availability in the shared quill-icons set.
type TIconProps = { className?: string };

export const AiAnalysisIcon = ({ className }: TIconProps) => (
    <svg className={className} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <path
            d='M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinecap='round'
        />
        <circle cx='12' cy='12' r='4.5' stroke='currentColor' strokeWidth='1.5' />
    </svg>
);

export const BulkTraderIcon = ({ className }: TIconProps) => (
    <svg className={className} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <rect x='3' y='4' width='7' height='7' rx='1.2' stroke='currentColor' strokeWidth='1.5' />
        <rect x='14' y='4' width='7' height='7' rx='1.2' stroke='currentColor' strokeWidth='1.5' />
        <rect x='3' y='15' width='7' height='7' rx='1.2' stroke='currentColor' strokeWidth='1.5' />
        <rect x='14' y='15' width='7' height='7' rx='1.2' stroke='currentColor' strokeWidth='1.5' />
    </svg>
);

export const LiveChartsIcon = ({ className }: TIconProps) => (
    <svg className={className} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <path d='M4 20V4M4 20h16' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
        <path
            d='M6.5 15l3.5-4 3 2.5L18 7'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

export const TradingBotsIcon = ({ className }: TIconProps) => (
    <svg className={className} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <rect x='5' y='9' width='14' height='10' rx='2' stroke='currentColor' strokeWidth='1.5' />
        <path d='M12 9V5M9 5h6' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
        <circle cx='9.5' cy='14' r='1.2' fill='currentColor' />
        <circle cx='14.5' cy='14' r='1.2' fill='currentColor' />
    </svg>
);

export const RiskCalculatorIcon = ({ className }: TIconProps) => (
    <svg className={className} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <rect x='5' y='3' width='14' height='18' rx='2' stroke='currentColor' strokeWidth='1.5' />
        <path d='M8 8h8M8 12h2M13 12h3M8 16h2M13 16h3' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
);

export const ReportsIcon = ({ className }: TIconProps) => (
    <svg className={className} viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <path d='M7 3h7l4 4v14H7z' stroke='currentColor' strokeWidth='1.5' strokeLinejoin='round' />
        <path d='M14 3v4h4' stroke='currentColor' strokeWidth='1.5' strokeLinejoin='round' />
        <path d='M9.5 16v-3M12.5 16v-5M15.5 16v-2' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
);
