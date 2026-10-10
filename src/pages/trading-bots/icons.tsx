/**
 * The marks on the Trading Bots tab strip, drawn as icons rather than typed as
 * emoji.
 *
 * They were 🤖 🛍️ ⚡ 🚀 🧮 📊. An emoji is a colour glyph the platform draws
 * however it likes: it carries its own palette into a strip that is otherwise
 * one blue and one grey, it sits on the typeface's baseline rather than the
 * row's, and it draws about a third taller than its font-size - which made it
 * the tallest thing in the tab and left the strip holding open around it. The
 * reference's own tabs use small flat glyphs, and that difference was the last
 * measurable gap between the two strips.
 *
 * One 24-unit grid, one stroke weight, stroked in currentColor, so a tab's
 * icon takes the same blue as its label when the tab is open and the same grey
 * when it is not - and sized by font-size, so one rule moves both.
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

/** Free Bots: a bot's head, antenna and two eyes. */
export const BotIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='1.7'>
        <rect x='4' y='8.5' width='16' height='11' rx='3' />
        <path d='M12 8.5V5' />
        <circle cx='12' cy='3.6' r='1.4' />
        <circle cx='9' cy='13.5' r='1.1' fill='currentColor' stroke='none' />
        <circle cx='15' cy='13.5' r='1.1' fill='currentColor' stroke='none' />
    </svg>
);

/** Bots Store: a shop bag with its handle. */
export const StoreIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='1.7'>
        <path d='M5 8h14l-1.1 11.2a1.8 1.8 0 01-1.8 1.6H7.9a1.8 1.8 0 01-1.8-1.6z' />
        <path d='M8.8 8V6.3a3.2 3.2 0 016.4 0V8' />
    </svg>
);

/** Scalper Bots: a bolt, for the quick ones. */
export const BoltIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='1.7'>
        <path d='M13.2 2.5L5 13.4h5.6l-.8 8.1L18 10.6h-5.6z' />
    </svg>
);

/** SpeedBots: a rocket, nose up, with its fins. */
export const RocketIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='1.7'>
        <path d='M12 2.6c3.1 2.4 4.8 5.8 4.8 9.6L14.6 17H9.4l-2.2-4.8c0-3.8 1.7-7.2 4.8-9.6z' />
        <circle cx='12' cy='10.2' r='1.9' />
        <path d='M9.4 17l-2.6 4.4 3.4-1.2M14.6 17l2.6 4.4-3.4-1.2' />
    </svg>
);

/** Calculator: a keypad with its display. */
export const CalculatorIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='1.7'>
        <rect x='5' y='2.8' width='14' height='18.4' rx='2.4' />
        <path d='M8.4 7h7.2' />
        <circle cx='9' cy='12' r='0.9' fill='currentColor' stroke='none' />
        <circle cx='15' cy='12' r='0.9' fill='currentColor' stroke='none' />
        <circle cx='9' cy='16.6' r='0.9' fill='currentColor' stroke='none' />
        <circle cx='15' cy='16.6' r='0.9' fill='currentColor' stroke='none' />
    </svg>
);

/** Strategies: three bars, the tallest last. */
export const BarsIcon = ({ className }: TIconProps) => (
    <svg className={className} {...base} strokeWidth='1.8'>
        <path d='M6 20v-5.5M12 20v-9.5M18 20V5' />
    </svg>
);
