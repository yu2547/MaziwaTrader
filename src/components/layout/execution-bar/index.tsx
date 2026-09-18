import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import RiskDisclaimer from '@/components/layout/footer/RiskDisclaimer';
import TradeAnimation from '@/components/trade-animation';
import { useStore } from '@/hooks/useStore';
import { StandaloneChevronUpBoldIcon } from '@deriv/quill-icons/Standalone';
import { localize } from '@deriv-com/translations';
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
 *
 * The floating AI and Gemini orbs used to hang off this component. They are in
 * layout/assistant-orbs now, because this bar is not mounted on DTrader and
 * they belong on every route.
 */
const ExecutionBar = observer(() => {
    const { run_panel } = useStore() ?? {};
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
        </>
    );
});

export default ExecutionBar;
