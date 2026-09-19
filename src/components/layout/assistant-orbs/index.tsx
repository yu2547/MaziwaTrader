import { CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
 * The "AI Market Scanner" card after a page load, as the reference has it:
 * shown once per mount - which is once per load or sign-in - a moment after
 * the app settles, held long enough to read, then eased away. INTRO_EXIT_MS
 * must match the exit animation in execution-bar.scss, which is how long the
 * card is held mounted while it fades.
 */
const INTRO_DELAY_MS = 900;
const INTRO_VISIBLE_MS = 4500;
const INTRO_EXIT_MS = 300;

/** Space between the card's pointer and the orb, and between the card and the screen edge. */
const INTRO_GAP_PX = 12;
const INTRO_EDGE_PX = 8;

type TIntroPhase = 'waiting' | 'shown' | 'leaving' | 'done';
type TIntroPlacement = { left: number; placement: 'above' | 'below'; pointer: number; top: number };

const AssistantOrbs = () => {
    const [is_ai_open, setIsAiOpen] = useState(false);
    // Kept mounted for the length of its exit animation - see closeAi below.
    const [is_ai_closing, setIsAiClosing] = useState(false);
    const exit_timer = useRef<number | null>(null);
    // Reported up by the scanner so the orb can show a scan is under way even
    // with the modal dismissed behind it.
    const [is_scanning, setIsScanning] = useState(false);
    const [is_gemini_open, setIsGeminiOpen] = useState(false);
    // The post-load card. Timed rather than dismissed, and never shown while
    // the scanner itself is open - pointing at a button the user is already
    // using would be noise.
    const [intro_phase, setIntroPhase] = useState<TIntroPhase>('waiting');
    const [intro_placement, setIntroPlacement] = useState<TIntroPlacement | null>(null);
    const [intro_element, setIntroElement] = useState<HTMLButtonElement | null>(null);

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
        // Opening the scanner answers the card, so it is done for good - it
        // does not come back when the scanner closes.
        setIntroPhase('done');
        setIsAiOpen(true);
    }, []);

    const openGemini = useCallback(() => setIsGeminiOpen(true), []);

    const ai_orb = useDraggableOrb({ onActivate: openAi, storage_key: AI_ORB_POS_KEY });
    const gemini_orb = useDraggableOrb({ onActivate: openGemini, storage_key: GEMINI_ORB_POS_KEY });

    // One shot per mount, which is per page load or sign-in - the component
    // goes up with the app shell and stays up. Each step only moves the card
    // forward from where it expects it to be, so opening the scanner part-way
    // through ('done') is never undone by a timer still pending.
    useEffect(() => {
        const advance = (from: TIntroPhase, to: TIntroPhase) => () =>
            setIntroPhase(current => (current === from ? to : current));
        const show = window.setTimeout(advance('waiting', 'shown'), INTRO_DELAY_MS);
        const leave = window.setTimeout(advance('shown', 'leaving'), INTRO_DELAY_MS + INTRO_VISIBLE_MS);
        const done = window.setTimeout(advance('leaving', 'done'), INTRO_DELAY_MS + INTRO_VISIBLE_MS + INTRO_EXIT_MS);
        return () => {
            window.clearTimeout(show);
            window.clearTimeout(leave);
            window.clearTimeout(done);
        };
    }, []);

    // Placed from the orb's measured box, and the card's own measured size,
    // before the card is painted - so it never appears in one place and jumps.
    // Measured rather than copied from the orb's CSS anchors: the orb is
    // draggable, and where it rests otherwise depends on the execution bar,
    // the run panel and the page.
    // Above the orb with its pointer on the orb's centre, as the reference has
    // it. The card is kept inside the screen, sliding sideways if the orb is
    // near an edge (the pointer stays on the orb), and flips below the orb only
    // when there is no room above - on DTrader, where the orb sits near the top.
    useLayoutEffect(() => {
        if (!intro_element || !ai_orb.element) return;
        const orb = ai_orb.element.getBoundingClientRect();
        const width = intro_element.offsetWidth;
        const height = intro_element.offsetHeight;
        const centre = orb.left + orb.width / 2;
        const left = Math.min(Math.max(centre - width / 2, INTRO_EDGE_PX), window.innerWidth - width - INTRO_EDGE_PX);
        const fits_above = orb.top - INTRO_GAP_PX - height >= INTRO_EDGE_PX;
        setIntroPlacement({
            left,
            placement: fits_above ? 'above' : 'below',
            // Held clear of the card's rounded corners.
            pointer: Math.min(Math.max(centre - left, 18), width - 18),
            top: fits_above ? orb.top - INTRO_GAP_PX - height : orb.bottom + INTRO_GAP_PX,
        });
    }, [intro_element, ai_orb.element, ai_orb.position]);

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
                {/* Signal points travelling the rings. Each is a carrier the
                    size of its ring, turning at its own speed, with the point
                    drawn at its top - so it rides the ring's line exactly. */}
                <span className='mw-exec-bar__ai-orbit mw-exec-bar__ai-orbit--1' aria-hidden='true' />
                <span className='mw-exec-bar__ai-orbit mw-exec-bar__ai-orbit--2' aria-hidden='true' />
                <span className='mw-exec-bar__ai-orbit mw-exec-bar__ai-orbit--3' aria-hidden='true' />
                <span className='mw-exec-bar__ai-orbit mw-exec-bar__ai-orbit--4' aria-hidden='true' />
                <span className='mw-exec-bar__ai-orbit mw-exec-bar__ai-orbit--5' aria-hidden='true' />
                {/* The lettering is its own layer so it sits above everything
                    else on the core - glass, light, beam and frame are all
                    absolutely positioned, which paints over a bare text node -
                    and so nothing animating the core can reach the letters. */}
                <span className='mw-exec-bar__ai-core'>
                    <span className='mw-exec-bar__ai-sweep' aria-hidden='true' />
                    {/* The scan field slides across the lettering, so it has a
                        clipped layer of its own: at each end of its travel it
                        meets the sphere's edge and is cut by it, rather than
                        spilling out. */}
                    <span className='mw-exec-bar__ai-scan' aria-hidden='true'>
                        <span className='mw-exec-bar__ai-frame' />
                    </span>
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
                dragged it; tapping it opens the scanner, the same as the orb.
                Hidden until it has been measured and placed, which happens
                before the first paint. aria-hidden because the orb already
                carries the same meaning in its own label; a screen reader
                should hear it once, not twice. */}
            {(intro_phase === 'shown' || intro_phase === 'leaving') && !is_ai_open && (
                <button
                    type='button'
                    ref={setIntroElement}
                    className={`mw-exec-bar__ai-hint mw-exec-bar__ai-hint--${
                        intro_placement?.placement ?? 'above'
                    }${intro_phase === 'leaving' ? ' mw-exec-bar__ai-hint--leaving' : ''}`}
                    style={
                        intro_placement
                            ? ({
                                  left: intro_placement.left,
                                  top: intro_placement.top,
                                  '--mw-hint-pointer': `${intro_placement.pointer}px`,
                              } as CSSProperties)
                            : { visibility: 'hidden' }
                    }
                    onClick={openAi}
                    tabIndex={-1}
                    aria-hidden='true'
                >
                    <span className='mw-exec-bar__ai-hint-icon'>🤖</span>
                    <span className='mw-exec-bar__ai-hint-body'>
                        <span className='mw-exec-bar__ai-hint-title'>{localize('AI Market Scanner')}</span>
                        <span className='mw-exec-bar__ai-hint-text'>
                            {localize('Click here to find optimal trading opportunities!')}
                        </span>
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
