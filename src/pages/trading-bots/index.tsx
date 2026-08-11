import { lazy, Suspense, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ChunkLoader from '@/components/loader/chunk-loader';
import { localize } from '@deriv-com/translations';
import FreeBots from '../free-bots';
import './trading-bots.scss';

const RiskCalculator = lazy(() => import('../risk-calculator'));

/**
 * Trading Bots is a shell around several scoped views of the same bot
 * catalogue plus the risk calculator. The sub-navigation stays mounted while
 * the panel below it changes, so switching views never takes the navigation
 * away with it.
 *
 * Scalper/Speed/Strategies are filters over the one catalogue in
 * ../free-bots rather than separate hardcoded lists, so adding a bot there
 * automatically surfaces it in whichever view its category belongs to.
 */

const TAB_IDS = {
    FREE: 'free',
    SCALPER: 'scalper',
    SPEED: 'speed',
    CALCULATOR: 'calculator',
    STRATEGIES: 'strategies',
} as const;

type TTabId = (typeof TAB_IDS)[keyof typeof TAB_IDS];

const TABS: Array<{ icon: string; id: TTabId; label: string }> = [
    { icon: '🤖', id: TAB_IDS.FREE, label: localize('Free Bots') },
    { icon: '⚡', id: TAB_IDS.SCALPER, label: localize('Scalper Bots') },
    { icon: '🚀', id: TAB_IDS.SPEED, label: localize('SpeedBots') },
    { icon: '🧮', id: TAB_IDS.CALCULATOR, label: localize('Calculator') },
    { icon: '📊', id: TAB_IDS.STRATEGIES, label: localize('Strategies') },
];

// Category names as they appear in the catalogue in ../free-bots.
const SCALPER_CATEGORIES = ['Even/Odd', 'Differ'];
const SPEED_CATEGORIES = ['Speed Trading'];
const STRATEGY_CATEGORIES = ['AI Trading', 'Pattern Analysis', 'Accumulators', 'Premium'];

const TradingBots = observer(() => {
    const [active_tab, setActiveTab] = useState<TTabId>(TAB_IDS.FREE);

    const renderPanel = () => {
        switch (active_tab) {
            case TAB_IDS.SCALPER:
                return (
                    <FreeBots
                        allowed_categories={SCALPER_CATEGORIES}
                        title={localize('Scalper Bots')}
                        subtitle={localize(
                            'Tick-level bots built for fast in-and-out trades on digit markets. Load one into Bot Builder to review its blocks before running it.'
                        )}
                    />
                );
            case TAB_IDS.SPEED:
                return (
                    <FreeBots
                        allowed_categories={SPEED_CATEGORIES}
                        title={localize('SpeedBots')}
                        subtitle={localize(
                            'Bots tuned for rapid execution with optimised entry and exit points. Load one into Bot Builder to review its blocks before running it.'
                        )}
                    />
                );
            case TAB_IDS.STRATEGIES:
                return (
                    <FreeBots
                        allowed_categories={STRATEGY_CATEGORIES}
                        title={localize('Strategies')}
                        subtitle={localize(
                            'Strategy-led bots: AI signals, candlestick patterns, accumulators and premium systems.'
                        )}
                    />
                );
            case TAB_IDS.CALCULATOR:
                return (
                    <Suspense fallback={<ChunkLoader message={localize('Loading calculator...')} />}>
                        <RiskCalculator />
                    </Suspense>
                );
            case TAB_IDS.FREE:
            default:
                return <FreeBots />;
        }
    };

    return (
        <div className='mw-trading-bots'>
            <nav className='mw-trading-bots__nav' aria-label={localize('Trading bots sections')}>
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        type='button'
                        className={`mw-trading-bots__tab${
                            active_tab === tab.id ? ' mw-trading-bots__tab--active' : ''
                        }`}
                        aria-current={active_tab === tab.id}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        <span aria-hidden='true'>{tab.icon}</span>
                        {tab.label}
                    </button>
                ))}
            </nav>

            <div className='mw-trading-bots__panel'>{renderPanel()}</div>
        </div>
    );
});

export default TradingBots;
