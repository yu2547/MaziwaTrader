import { useCallback, useEffect, useRef, useState } from 'react';
import GeminiPanel from '@/pages/gemini/gemini-panel';
import { localize } from '@deriv-com/translations';
import EntryScanner from '../execution-bar/entry-scanner';
import useDraggableOrb from './use-draggable-orb';
import '../execution-bar/execution-bar.scss';
import './assistant-orbs.scss';

/**
 * The two floating assistants - the violet AI scanner and the red Gemini -
 * and the panels they open.
 *
 * They live in the shell rather than in the execution bar, which is what they
 * used to hang off. The bar is not mounted on DTrader (components/layout
 * skips it there so the page has the width to itself), and the reference has
 * both orbs on that page as much as on any other, so tying them to the bar
 * meant they simply vanished on it.
 *
 * They keep their execution-bar class names: the selectors are flat rather
 * than nested under .mw-exec-bar, so moving the markup costs no stylesheet
 * churn, and renaming a working orb's CSS is not worth the risk of a missed
 * rule.
 */

const AI_ORB_POS_KEY = 'mw_ai_orb_position';
const GEMINI_ORB_POS_KEY = 'mw_gemini_orb_position';

/**
 * How long the scanner is held mounted while it animates out. Deliberately
 * longer than the 200ms animation in execution-bar.scss: the closing class only
 * lands on the next render, so the animation starts a frame or two after this
 * timer does. Measured without the margin, the sheet was still at 59% opacity
 * when it unmounted - a visible pop at the end of the fade. The animation holds
 * its last frame (`forwards`), so the extra time costs nothing.
 */
const AI_EXIT_MS = 260;

/**
 * The hint beside the orb after a page load, as the reference has it: it
 * arrives a moment after the app has settled and leaves on its own. Long
 * enough to read twice, short enough not to become furniture.
 */
const AI_HINT_DELAY_MS = 1400;
const AI_HINT_VISIBLE_MS = 7000;

const AssistantOrbs = () => {
    const [is_ai_open, setIsAiOpen] = useState(false);
    // Kept mounted for the length of its exit animation - see closeAi below.
    const [is_ai_closing, setIsAiClosing] = useState(false);
    const exit_timer = useRef<number | null>(null);
    // Reported up by the scanner so the orb can show a scan is under way even
    // with the modal dismissed behind it.
    const [is_scanning, setIsScanning] = useState(false);
    const [is_gemini_open, setIsGeminiOpen] = useState(false);
    // The post-load hint. Timed rather than dismissed, and never shown while
    // the scanner itself is open - pointing at a button the user is already
    // using would be noise.
    const [is_hint_shown, setIsHintShown] = useState(false);
    const [hint_position, setHintPosition] = useState<{ right: number; top: number } | null>(null);

    // The scanner animates in over 220ms but used to vanish on the frame it
    // closed, because it is mounted conditionally and unmounting cannot be
    // transitioned. It is held on screen for the length of its exit instead,
    // with the closing class driving the reverse of the entrance, so opening
    // and closing are the same movement in both directions.
    const closeAi = useCallback(() => {
        setIsAiClosing(true);
        exit_timer.current = window.setTimeout(() => {
            setIsAiOpen(false);
            setIsAiClosing(false);
        }, AI_EXIT_MS);
    }, []);

    // Reopening mid-exit has to cancel the pending unmount, or the scanner
    // would close again a moment after the user asked for it back.
    const openAi = useCallback(() => {
        if (exit_timer.current) window.clearTimeout(exit_timer.current);
        setIsAiClosing(false);
        setIsHintShown(false);
        setIsAiOpen(true);
    }, []);

    const openGemini = useCallback(() => setIsGeminiOpen(true), []);

    const ai_orb = useDraggableOrb({ onActivate: openAi, storage_key: AI_ORB_POS_KEY });
    const gemini_orb = useDraggableOrb({ onActivate: openGemini, storage_key: GEMINI_ORB_POS_KEY });

    // One shot per mount, which is per page load or sign-in - the component
    // goes up with the app shell and stays up.
    useEffect(() => {
        const show = window.setTimeout(() => setIsHintShown(true), AI_HINT_DELAY_MS);
        const hide = window.setTimeout(() => setIsHintShown(false), AI_HINT_DELAY_MS + AI_HINT_VISIBLE_MS);
        return () => {
            window.clearTimeout(show);
            window.clearTimeout(hide);
        };
    }, []);

    // Placed from the orb's measured position rather than from a copy of its
    // CSS anchors: the orb is draggable, and where it rests otherwise depends
    // on the execution bar's height and on whether the run panel's statistics
    // are up. Measuring is the only way to sit beside it in all of those.
    useEffect(() => {
        if (!is_hint_shown || !ai_orb.element) return;
        const box = ai_orb.element.getBoundingClientRect();
        // Anchored by its right edge, not its left. A fixed box positioned from
        // the left takes its available width from there to the edge of the
        // screen - beside an orb in the bottom-right corner that is about 90px,
        // so the card came out a narrow column of wrapped words. From the right
        // it grows back across the screen instead.
        setHintPosition({ right: window.innerWidth - (box.left - 8), top: box.top + box.height / 2 });
    }, [is_hint_shown, ai_orb.element, ai_orb.position]);

    useEffect(
        () => () => {
            if (exit_timer.current) window.clearTimeout(exit_timer.current);
        },
        []
    );

    // The Signals panel's "Launch AI" opens this scanner rather than starting
    // one of its own. A window event rather than a store field because the orb
    // owns this state and nothing else needs to read it - the panel only needs
    // to ask, and this is the whole of the asking.
    useEffect(() => {
        const open = () => openAi();
        window.addEventListener('mw:open-entry-scanner', open);
        return () => window.removeEventListener('mw:open-entry-scanner', open);
    }, [openAi]);

    return (
        <>
            {/* Draggable: press and move to reposition, press and release to
                open. Inline left/top only once it has been moved, so an
                untouched orb keeps the corner the stylesheet gives it. */}
            <button
                type='button'
                className={`mw-exec-bar__ai${ai_orb.is_dragging ? ' mw-exec-bar__ai--dragging' : ''}${
                    is_scanning ? ' mw-exec-bar__ai--scanning' : ''
                }`}
                style={ai_orb.style}
                aria-expanded={is_ai_open}
                aria-haspopup='dialog'
                aria-label={localize('Entry Scanner')}
                {...ai_orb.handlers}
            >
                <span className='mw-exec-bar__ai-ring' aria-hidden='true' />
                <span className='mw-exec-bar__ai-ring mw-exec-bar__ai-ring--mid' aria-hidden='true' />
                <span className='mw-exec-bar__ai-ring mw-exec-bar__ai-ring--wide' aria-hidden='true' />
                {/* The lettering is its own layer so it sits above the core's
                    glass and scanning sheen - both are absolutely positioned
                    pseudo-elements, which paint over a bare text node - and so
                    nothing animating the core can reach the letters. */}
                <span className='mw-exec-bar__ai-core'>
                    <span className='mw-exec-bar__ai-sweep' aria-hidden='true' />
                    <span className='mw-exec-bar__ai-text'>AI</span>
                </span>
                <span className='mw-exec-bar__ai-dot' aria-hidden='true' />
            </button>

            {/* Gemini's own sphere, the same instrument in red and parked
                directly above the scanner's. Same drag and press behaviour,
                its own remembered position. */}
            <button
                type='button'
                className={`mw-gem-orb${gemini_orb.is_dragging ? ' mw-gem-orb--dragging' : ''}${
                    is_gemini_open ? ' mw-gem-orb--open' : ''
                }`}
                style={gemini_orb.style}
                aria-expanded={is_gemini_open}
                aria-haspopup='dialog'
                aria-label={localize('Gemini trading assistant')}
                {...gemini_orb.handlers}
            >
                <span className='mw-gem-orb__halo' aria-hidden='true' />
                <span className='mw-gem-orb__core'>
                    {/* The light moving inside the sphere. Its own clipped layer
                        so nothing that drifts can cross the orb's edge, and
                        behind the lettering, which never moves. */}
                    <span className='mw-gem-orb__field' aria-hidden='true'>
                        <span className='mw-gem-orb__bubble mw-gem-orb__bubble--1' />
                        <span className='mw-gem-orb__bubble mw-gem-orb__bubble--2' />
                        <span className='mw-gem-orb__bubble mw-gem-orb__bubble--3' />
                        <span className='mw-gem-orb__bubble mw-gem-orb__bubble--4' />
                        <span className='mw-gem-orb__bubble mw-gem-orb__bubble--5' />
                    </span>
                    <span className='mw-gem-orb__text'>GEMINI</span>
                </span>
                <span className='mw-gem-orb__dot' aria-hidden='true' />
            </button>

            {/* Says what the orb is, once, shortly after the app settles - the
                orb is a lettered sphere with no label, and nothing else on the
                page explains it. It follows the orb wherever the user has
                dragged it, and opening the scanner takes it away early.
                aria-hidden because the orb already carries the same meaning in
                its own label; a screen reader should hear it once, not twice. */}
            {is_hint_shown && !is_ai_open && hint_position && (
                <button
                    type='button'
                    className='mw-exec-bar__ai-hint'
                    style={{ right: hint_position.right, top: hint_position.top }}
                    onClick={openAi}
                    tabIndex={-1}
                    aria-hidden='true'
                >
                    <span className='mw-exec-bar__ai-hint-title'>{localize('AI Market Scanner')}</span>
                    <span className='mw-exec-bar__ai-hint-text'>
                        {localize('Tap to find optimal trading opportunities')}
                    </span>
                </button>
            )}

            {/* Held mounted through its exit. The wrapper only carries the
                closing flag - the scanner keeps its own props and state - and
                the stylesheet runs the reverse of the entrance on the sheet
                and the backdrop from there. */}
            {(is_ai_open || is_ai_closing) && (
                <div className={is_ai_closing ? 'mw-scanner-exit' : undefined}>
                    <EntryScanner onClose={closeAi} onScanningChange={setIsScanning} />
                </div>
            )}

            {/* Unmounted rather than hidden when closed: it holds a market
                subscription per volatility index, and a closed panel has no
                business keeping those open. */}
            {is_gemini_open && <GeminiPanel onClose={() => setIsGeminiOpen(false)} />}
        </>
    );
};

export default AssistantOrbs;
