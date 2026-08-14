import { startTransition, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import TradeAnimation from '@/components/trade-animation';
import ContractStageText from '@/components/trade-animation/contract-stage-text';
import { DBOT_TABS } from '@/constants/bot-contents';
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
 * - The execution status is the live contract stage, the same text the run
 *   panel's own header shows, so it changes the moment the bot starts,
 *   buys, or stops.
 * - The handle toggles run_panel.is_drawer_open, which is the run panel's
 *   own open state, not a private copy of it.
 *
 * Deliberately NOT here: a FAST/SLOW execution-speed switch. The reference
 * has one, but this engine has no speed setting for it to drive, and a
 * control wired to nothing would be exactly the visual mock this is supposed
 * to avoid. The slot shows real bot state instead.
 */
const ExecutionBar = observer(() => {
    const { run_panel, dashboard, quick_strategy } = useStore() ?? {};
    const navigate = useNavigate();
    const [is_ai_open, setIsAiOpen] = useState(false);

    if (!run_panel) return null;

    const { is_drawer_open, toggleDrawer, is_running, contract_stage } = run_panel;

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
                        <TradeAnimation className='mw-exec-bar__animation' />
                    </div>

                    <div className='mw-exec-bar__status'>
                        <span className='mw-exec-bar__status-label'>{localize('Execution')}</span>
                        <span className='mw-exec-bar__status-value'>
                            <ContractStageText contract_stage={contract_stage} />
                        </span>
                    </div>

                    {/* Two labels rather than a truncated one: at phone
                        widths the full wording is what pushed this row past
                        the viewport. */}
                    <button type='button' className='mw-exec-bar__config' onClick={openTradingConfiguration}>
                        <span className='mw-exec-bar__config-long'>{localize('Trading Configuration')}</span>
                        <span className='mw-exec-bar__config-short'>{localize('Config')}</span>
                    </button>
                </div>
            </div>

            <button
                type='button'
                className='mw-exec-bar__ai'
                onClick={() => setIsAiOpen(prev => !prev)}
                aria-expanded={is_ai_open}
                aria-label={localize('AI assistant')}
            >
                AI
            </button>

            {is_ai_open && (
                <div className='mw-exec-bar__ai-panel' role='dialog' aria-label={localize('AI assistant')}>
                    <div className='mw-exec-bar__ai-panel-title'>{localize('AI assistant')}</div>
                    <p>
                        {localize(
                            'No analysis backend is connected to this build, so there is nothing here to report yet. This panel stays empty rather than showing generated numbers that were never measured.'
                        )}
                    </p>
                    <button type='button' onClick={() => setIsAiOpen(false)}>
                        {localize('Close')}
                    </button>
                </div>
            )}
        </>
    );
});

export default ExecutionBar;
