import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import RiskDisclaimer from '@/components/layout/footer/RiskDisclaimer';
import TradeAnimation from '@/components/trade-animation';
import { useStore } from '@/hooks/useStore';
import { StandaloneChevronUpBoldIcon } from '@deriv/quill-icons/Standalone';
import { localize } from '@deriv-com/translations';
import EntryScanner from './entry-scanner';
import './execution-bar.scss';

/**
 * The app's execution area, owned by the shell rather than by any page, so it
 * is reachable from every route - Bulk Trader, Analysis Tool, Charts - and
 * survives navigation instead of being torn down with the page that happened
 * to render it.
 *
 * Everything here is the real thing:
 * - The Run/Stop control is <TradeAnimation/>, the same component the bot
 *   builder used, bound to run_panel.onRunButtonClick / onStopBotClick. It is
 *   not a second button that mimics it.
 * - The handle toggles run_panel.is_drawer_open, which is the run panel's
 *   own open state, not a private copy of it.
 *
 * The live contract stage is not shown here. The run panel directly below
 * already reports it, and a second copy on the card was only repeating what
 * was already on screen a few pixels away.
 *
 * An Execution FAST/SLOW switch used to sit on the right of the bar. It was a
 * persisted preference that no engine path ever read: the one thing it could
 * have selected - buying straight from parameters rather than from a proposal
 * id - is rejected by the Options API on the OTP transport. It has been
 * removed rather than left as a control that does nothing.
 */
const ORB_POS_KEY = 'mw_ai_orb_position';
// Must track the orb's rendered width (7.2rem in execution-bar.scss at the
// app's 10px root). It was 64 while the orb drew at 84, so every clamp allowed
// it 20px past the right and bottom edges - the corner it is most often
// dragged to, and the one where it then sat half off a narrow phone.
const ORB_SIZE = 72;
/**
 * How long the scanner is held mounted while it animates out. Deliberately
 * longer than the 200ms animation in execution-bar.scss: the closing class only
 * lands on the next render, so the animation starts a frame or two after this
 * timer does. Measured without the margin, the sheet was still at 59% opacity
 * when it unmounted - a visible pop at the end of the fade. The animation holds
 * its last frame (`forwards`), so the extra time costs nothing.
 */
const AI_EXIT_MS = 260;
const ORB_MARGIN = 8;
/** Past this much movement a press is a drag, not a click. */
const DRAG_SLOP = 4;

type TPoint = { x: number; y: number };

const readStoredPosition = (): TPoint | null => {
    try {
        const raw = sessionStorage.getItem(ORB_POS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return typeof parsed?.x === 'number' && typeof parsed?.y === 'number' ? parsed : null;
    } catch {
        return null;
    }
};

const clampToViewport = ({ x, y }: TPoint): TPoint => ({
    x: Math.min(Math.max(x, ORB_MARGIN), window.innerWidth - ORB_SIZE - ORB_MARGIN),
    y: Math.min(Math.max(y, ORB_MARGIN), window.innerHeight - ORB_SIZE - ORB_MARGIN),
});

const ExecutionBar = observer(() => {
    const { run_panel } = useStore() ?? {};
    const [is_ai_open, setIsAiOpen] = useState(false);
    // Kept mounted for the length of its exit animation - see closeAi below.
    const [is_ai_closing, setIsAiClosing] = useState(false);
    const exit_timer = useRef<number | null>(null);
    // Reported up by the scanner so the orb can show a scan is under way even
    // with the modal dismissed behind it.
    const [is_scanning, setIsScanning] = useState(false);
    // Where the user last put the orb. Null means "wherever the stylesheet
    // parks it", so an untouched orb keeps its default corner.
    // Clamped on the way in, not just on resize: the stored point was written
    // against whatever viewport the user last dragged it on, so restoring it on
    // a narrower phone - or in portrait after landscape - put the orb partly or
    // wholly off-screen, and the resize listener below only fires if the window
    // then changes again.
    const [orb_position, setOrbPosition] = useState<TPoint | null>(() => {
        const stored = readStoredPosition();
        return stored ? clampToViewport(stored) : null;
    });
    const [is_dragging, setIsDragging] = useState(false);
    const drag = useRef({ active: false, moved: false, dx: 0, dy: 0 });
    // A callback ref rather than useRef: the bar does not render on the first
    // pass (the store is still being built, and the component returns null
    // until it exists), so an effect keyed on [] measured a ref that was still
    // null and never ran again once the bar appeared. This re-runs whenever
    // the node actually mounts.
    const [bar_element, setBarElement] = useState<HTMLDivElement | null>(null);

    // The bar is fixed, so it is out of flow and sits over whatever the
    // workspace ends with. The content below reserves exactly its height -
    // measured rather than guessed at, because the bar is taller when the
    // FAST/SLOW switch wraps and taller again while a bot is running, and a
    // hardcoded figure is a dead gap at one width and a covered block at
    // another.
    useEffect(() => {
        if (!bar_element) return undefined;

        const publish = () => {
            document.documentElement.style.setProperty('--mw-exec-bar-height', `${bar_element.offsetHeight}px`);
        };
        publish();

        const observer = new ResizeObserver(publish);
        observer.observe(bar_element);
        return () => {
            observer.disconnect();
            document.documentElement.style.removeProperty('--mw-exec-bar-height');
        };
    }, [bar_element]);

    // A window that shrank past the orb would otherwise strand it off-screen.
    useEffect(() => {
        if (!orb_position) return undefined;
        const onResize = () => setOrbPosition(current => (current ? clampToViewport(current) : current));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [orb_position]);

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
        setIsAiOpen(true);
    }, []);

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

    // The orb opens from pointerup, so that a press which moved counts as a
    // drag rather than a click. Keyboard activation fires no pointer events at
    // all - Enter and Space on a <button> raise only `click` - so that path
    // left the orb focusable, labelled, and completely inert: tab to it, press
    // Enter, nothing happens.
    //
    // Handled here rather than by adding onClick, because a click also arrives
    // at the end of a real drag, and opening the scanner every time the user
    // finished repositioning the orb is the bug the pointerup logic exists to
    // avoid. preventDefault stops the browser's synthetic click on top of this.
    const onOrbKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openAi();
    };

    const onOrbPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        drag.current = { active: true, moved: false, dx: event.clientX - box.left, dy: event.clientY - box.top };
        // Capture keeps the drag alive if the pointer outruns the orb, but it
        // throws for a pointer the browser is not tracking. Losing capture
        // only costs a rougher drag; letting it throw here would abort the
        // handler and leave the orb unable to open at all.
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Drag still works, it just stops if the pointer leaves the orb.
        }
    };

    const onOrbPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!drag.current.active) return;
        const next = clampToViewport({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy });
        const box = event.currentTarget.getBoundingClientRect();
        if (Math.abs(next.x - box.left) > DRAG_SLOP || Math.abs(next.y - box.top) > DRAG_SLOP) {
            drag.current.moved = true;
            setIsDragging(true);
        }
        if (drag.current.moved) setOrbPosition(next);
    };

    const onOrbPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!drag.current.active) return;
        drag.current.active = false;
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // Nothing to release - not a reason to skip the click below.
        }
        setIsDragging(false);
        // A press that never moved is a click - open the scanner. A press that
        // moved was a drag, and should not also open it.
        if (!drag.current.moved) {
            openAi();
            return;
        }
        setOrbPosition(current => {
            if (current) sessionStorage.setItem(ORB_POS_KEY, JSON.stringify(current));
            return current;
        });
    };

    if (!run_panel) return null;

    const { is_drawer_open, toggleDrawer, is_running } = run_panel;

    // The Trading Configuration button used to live here as well. It now sits
    // directly under the digit circles on the Analysis page, which is where a
    // distribution is actually read and acted on - and having it in one place
    // means there is one way in rather than two that can drift apart.

    return (
        <>
            <div className={`mw-exec-bar ${is_running ? 'mw-exec-bar--running' : ''}`} ref={setBarElement}>
                {/* A sibling of the bar rather than a cell inside it. On a
                    phone the bar spans the viewport and this is its handle,
                    sitting centred above it; inside __inner it could only ever
                    be the last cell of a row, i.e. pinned to one end. The
                    column is align-items: flex-end on desktop, which keeps it
                    at the card's right edge as before. */}
                <button
                    type='button'
                    className={`mw-exec-bar__handle ${is_drawer_open ? 'mw-exec-bar__handle--open' : ''}`}
                    onClick={() => toggleDrawer(!is_drawer_open)}
                    aria-expanded={is_drawer_open}
                    aria-label={is_drawer_open ? localize('Hide run panel') : localize('Show run panel')}
                >
                    <StandaloneChevronUpBoldIcon iconSize='xs' />
                </button>

                <div className='mw-exec-bar__inner'>
                    <div className='mw-exec-bar__run'>
                        {/* should_show_overlay puts the settled result - Won
                            or Lost, from the real contract - across the status
                            area. The bar never passed it, so a finished trade
                            went straight from "Contract bought" to the next
                            one with no result shown, which reads as the bot
                            stalling. The phone drawer's footer used to carry a
                            copy of this control that did pass it; that copy was
                            removed and the result went with it. Shown on
                            phones only (execution-bar.scss). */}
                        <TradeAnimation className='mw-exec-bar__animation' should_show_overlay />
                    </div>
                </div>
            </div>

            {/* The Risk Disclaimer on a phone. The footer that carries it is
                only drawn from 1280px up, so phones had none. Same component -
                same pill, same dialog, portalled to the body - positioned just
                above the bar in execution-bar.scss and hidden on wider screens,
                where the footer already has one. */}
            <div className='mw-exec-bar__disclaimer'>
                <RiskDisclaimer />
            </div>

            {/* Draggable: press and move to reposition, press and release to
                open. Inline left/top only once it has been moved, so an
                untouched orb keeps the corner the stylesheet gives it. */}
            <button
                type='button'
                className={`mw-exec-bar__ai${is_dragging ? ' mw-exec-bar__ai--dragging' : ''}${
                    is_scanning ? ' mw-exec-bar__ai--scanning' : ''
                }`}
                style={
                    orb_position
                        ? { left: orb_position.x, top: orb_position.y, right: 'auto', bottom: 'auto' }
                        : undefined
                }
                onPointerDown={onOrbPointerDown}
                onPointerMove={onOrbPointerMove}
                onPointerUp={onOrbPointerUp}
                onPointerCancel={onOrbPointerUp}
                onKeyDown={onOrbKeyDown}
                aria-expanded={is_ai_open}
                aria-haspopup='dialog'
                aria-label={localize('Entry Scanner')}
            >
                <span className='mw-exec-bar__ai-ring' aria-hidden='true' />
                <span className='mw-exec-bar__ai-ring mw-exec-bar__ai-ring--mid' aria-hidden='true' />
                <span className='mw-exec-bar__ai-ring mw-exec-bar__ai-ring--wide' aria-hidden='true' />
                {/* The lettering is its own layer so it sits above the core's
                    glass and scanning sheen - both are absolutely positioned
                    pseudo-elements, which paint over a bare text node - and so
                    nothing animating the core can reach the letters. */}
                <span className='mw-exec-bar__ai-core'>
                    <span className='mw-exec-bar__ai-text'>AI</span>
                </span>
                <span className='mw-exec-bar__ai-dot' aria-hidden='true' />
            </button>

            {/* Held mounted through its exit. The wrapper only carries the
                closing flag - the scanner keeps its own props and state - and
                the stylesheet runs the reverse of the entrance on the sheet
                and the backdrop from there. */}
            {(is_ai_open || is_ai_closing) && (
                <div className={is_ai_closing ? 'mw-scanner-exit' : undefined}>
                    <EntryScanner onClose={closeAi} onScanningChange={setIsScanning} />
                </div>
            )}
        </>
    );
});

export default ExecutionBar;
