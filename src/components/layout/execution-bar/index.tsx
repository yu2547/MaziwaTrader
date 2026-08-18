import React, { startTransition, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import TradeAnimation from '@/components/trade-animation';
import { DBOT_TABS } from '@/constants/bot-contents';
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
 * The one thing here that is presentation only is the FAST/SLOW switch. It is
 * a real, persisted user setting - it remembers what you picked - but no
 * engine path reads it yet. The obvious candidate, buying straight from
 * parameters instead of from a proposal id, is not usable on the OTP
 * transport (the Options API rejects that request shape), so binding the
 * switch to it would break trading rather than speed it up. Left honest and
 * user-controlled until there is a second path worth selecting.
 */
const SPEED_KEY = 'mw_execution_speed';
const ORB_POS_KEY = 'mw_ai_orb_position';
const ORB_SIZE = 64;
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
    const { run_panel, dashboard, quick_strategy } = useStore() ?? {};
    const navigate = useNavigate();
    const [is_ai_open, setIsAiOpen] = useState(false);
    const [is_fast, setIsFast] = useState(() => sessionStorage.getItem(SPEED_KEY) !== 'slow');
    // Where the user last put the orb. Null means "wherever the stylesheet
    // parks it", so an untouched orb keeps its default corner.
    const [orb_position, setOrbPosition] = useState<TPoint | null>(readStoredPosition);
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
            setIsAiOpen(true);
            return;
        }
        setOrbPosition(current => {
            if (current) sessionStorage.setItem(ORB_POS_KEY, JSON.stringify(current));
            return current;
        });
    };

    if (!run_panel) return null;

    const { is_drawer_open, toggleDrawer, is_running } = run_panel;

    const toggleSpeed = () => {
        setIsFast(prev => {
            sessionStorage.setItem(SPEED_KEY, prev ? 'slow' : 'fast');
            return !prev;
        });
    };

    // Reuses the app's own trading configuration - Quick Strategy - rather
    // than introducing a second one. It only renders inside the Bot Builder
    // tab, so this goes there and opens it.
    const openTradingConfiguration = () => {
        startTransition(() => {
            navigate('/');
            dashboard?.setActiveTab(DBOT_TABS.BOT_BUILDER);
            quick_strategy?.setFormVisibility(true);
        });
    };

    return (
        <>
            <div className={`mw-exec-bar ${is_running ? 'mw-exec-bar--running' : ''}`} ref={setBarElement}>
                <div className='mw-exec-bar__inner'>
                    <div className='mw-exec-bar__run'>
                        <TradeAnimation className='mw-exec-bar__animation' />
                    </div>

                    <button
                        type='button'
                        className={`mw-exec-bar__status ${is_fast ? '' : 'mw-exec-bar__status--slow'}`}
                        onClick={toggleSpeed}
                        role='switch'
                        aria-checked={is_fast}
                        title={localize('Execution speed')}
                    >
                        <span className='mw-exec-bar__status-label'>{localize('Execution')}</span>
                        <span className='mw-exec-bar__status-value'>
                            {is_fast ? localize('FAST') : localize('SLOW')}
                        </span>
                        <span
                            className={`mw-exec-bar__switch ${is_fast ? 'mw-exec-bar__switch--on' : ''}`}
                            aria-hidden='true'
                        />
                    </button>

                    <button
                        type='button'
                        className={`mw-exec-bar__handle ${is_drawer_open ? 'mw-exec-bar__handle--open' : ''}`}
                        onClick={() => toggleDrawer(!is_drawer_open)}
                        aria-expanded={is_drawer_open}
                        aria-label={is_drawer_open ? localize('Hide run panel') : localize('Show run panel')}
                    >
                        <StandaloneChevronUpBoldIcon iconSize='xs' />
                    </button>
                </div>

                {/* Two labels rather than a truncated one: at phone widths the
                    full wording is what pushed this row past the viewport. */}
                <button type='button' className='mw-exec-bar__config' onClick={openTradingConfiguration}>
                    <span className='mw-exec-bar__config-long'>{localize('Trading Configuration')}</span>
                    <span className='mw-exec-bar__config-short'>{localize('Config')}</span>
                </button>
            </div>

            {/* Draggable: press and move to reposition, press and release to
                open. Inline left/top only once it has been moved, so an
                untouched orb keeps the corner the stylesheet gives it. */}
            <button
                type='button'
                className={`mw-exec-bar__ai ${is_dragging ? 'mw-exec-bar__ai--dragging' : ''}`}
                style={
                    orb_position
                        ? { left: orb_position.x, top: orb_position.y, right: 'auto', bottom: 'auto' }
                        : undefined
                }
                onPointerDown={onOrbPointerDown}
                onPointerMove={onOrbPointerMove}
                onPointerUp={onOrbPointerUp}
                onPointerCancel={onOrbPointerUp}
                aria-haspopup='dialog'
                aria-label={localize('Entry Scanner')}
            >
                <span className='mw-exec-bar__ai-ring' aria-hidden='true' />
                <span className='mw-exec-bar__ai-ring mw-exec-bar__ai-ring--mid' aria-hidden='true' />
                <span className='mw-exec-bar__ai-ring mw-exec-bar__ai-ring--wide' aria-hidden='true' />
                <span className='mw-exec-bar__ai-core'>AI</span>
                <span className='mw-exec-bar__ai-dot' aria-hidden='true' />
            </button>

            {is_ai_open && <EntryScanner onClose={() => setIsAiOpen(false)} />}
        </>
    );
});

export default ExecutionBar;
