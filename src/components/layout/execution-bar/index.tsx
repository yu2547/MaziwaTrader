import { startTransition, useState } from 'react';
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

const ExecutionBar = observer(() => {
    const { run_panel, dashboard, quick_strategy } = useStore() ?? {};
    const navigate = useNavigate();
    const [is_ai_open, setIsAiOpen] = useState(false);
    const [is_fast, setIsFast] = useState(() => sessionStorage.getItem(SPEED_KEY) !== 'slow');

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
            <div className={`mw-exec-bar ${is_running ? 'mw-exec-bar--running' : ''}`}>
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

            <button
                type='button'
                className='mw-exec-bar__ai'
                onClick={() => setIsAiOpen(true)}
                aria-haspopup='dialog'
                aria-label={localize('Entry Scanner')}
            >
                <span className='mw-exec-bar__ai-ring' aria-hidden='true' />
                <span className='mw-exec-bar__ai-ring mw-exec-bar__ai-ring--wide' aria-hidden='true' />
                <span className='mw-exec-bar__ai-core'>AI</span>
                <span className='mw-exec-bar__ai-dot' aria-hidden='true' />
            </button>

            {is_ai_open && <EntryScanner onClose={() => setIsAiOpen(false)} />}
        </>
    );
});

export default ExecutionBar;
