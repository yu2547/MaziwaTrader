/**
 * The mark on the Trading Bots tabs.
 *
 * One icon, repeated on every tab, because that is what the reference does:
 * magnified out of its own screenshot, all four of its tabs carry the same
 * jigsaw-piece outline, and what tells them apart is the label and - on two of
 * them - a small emoji after it.
 *
 * It replaced 🤖 🛍️ ⚡ 🚀 🧮 📊, and briefly six drawings of my own, one per
 * tab. Six distinct marks was the more obvious design and the wrong answer:
 * the brief was to match the reference, and the reference does not do that.
 *
 * Drawn rather than typed. An emoji is a colour glyph the platform draws
 * however it likes: it carries its own palette into a strip that is otherwise
 * one blue and one grey, it sits on the typeface's baseline rather than the
 * row's, and it draws about a third taller than its font-size - which made it
 * the tallest thing in the tab and held the strip open around it. This is
 * stroked in currentColor, so it takes the tab's blue when the tab is open and
 * its grey when it is not, and is sized in em so it tracks the label.
 */
type TIconProps = { className?: string };

/** A jigsaw piece: knob on top, socket on the right. */
export const PuzzleIcon = ({ className }: TIconProps) => (
    <svg
        className={className}
        aria-hidden='true'
        fill='none'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
    >
        <path d='M10.2 3.6a2.3 2.3 0 014.6 0c0 .5-.16.97-.43 1.35H18a1.6 1.6 0 011.6 1.6v3.6a2.3 2.3 0 10 0 4.17V18a1.6 1.6 0 01-1.6 1.6H6A1.6 1.6 0 014.4 18V6.55A1.6 1.6 0 016 4.95h4.63a2.28 2.28 0 01-.43-1.35z' />
    </svg>
);
