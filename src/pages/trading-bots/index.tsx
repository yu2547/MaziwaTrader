import { lazy, Suspense, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ChunkLoader from '@/components/loader/chunk-loader';
import { localize } from '@deriv-com/translations';
import FreeBots from '../free-bots';
import { PuzzleIcon } from './icons';
import './trading-bots.scss';

const RiskCalculator = lazy(() => import('../risk-calculator'));
const BotsStore = lazy(() => import('../bots-store'));
const ScalperBots = lazy(() => import('../scalper-bots'));
const SpeedBots = lazy(() => import('../speed-bots'));

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
    STORE: 'store',
    SCALPER: 'scalper',
    SPEED: 'speed',
    CALCULATOR: 'calculator',
    STRATEGIES: 'strategies',
} as const;

type TTabId = (typeof TAB_IDS)[keyof typeof TAB_IDS];

// One drawn mark on every tab and an emoji after the label on two of them,
// which is how the reference's own strip reads - see ./icons.
const TABS: Array<{ flies?: boolean; id: TTabId; label: string; trailing?: string }> = [
    { id: TAB_IDS.FREE, label: localize('Free Bots') },
    { id: TAB_IDS.STORE, label: localize('Bots Store') },
    { id: TAB_IDS.SCALPER, label: localize('Scalper Bots'), trailing: '⚡' },
    // The rocket climbs and begins again - see mw-tab-fly in the stylesheet.
    { flies: true, id: TAB_IDS.SPEED, label: localize('SpeedBots'), trailing: '🚀' },
    { id: TAB_IDS.CALCULATOR, label: localize('Calculator') },
    { id: TAB_IDS.STRATEGIES, label: localize('Strategies') },
];

// Category names as they appear in the catalogue in ../free-bots. Scalper Bots
// and SpeedBots are their own pages now and scope themselves; only Strategies
// is still a filtered view of the catalogue.
const STRATEGY_CATEGORIES = ['AI Trading', 'Pattern Analysis', 'Accumulators', 'Premium'];

const TradingBots = observer(() => {
    const [active_tab, setActiveTab] = useState<TTabId>(TAB_IDS.FREE);

    const renderPanel = () => {
        switch (active_tab) {
            case TAB_IDS.STORE:
                return (
                    <Suspense fallback={<ChunkLoader message={localize('Loading bots store...')} />}>
                        <BotsStore />
                    </Suspense>
                );
            case TAB_IDS.SCALPER:
                return (
                    <Suspense fallback={<ChunkLoader message={localize('Loading scalper bots...')} />}>
                        <ScalperBots />
                    </Suspense>
                );
            case TAB_IDS.SPEED:
                return (
                    <Suspense fallback={<ChunkLoader message={localize('Loading speed bots...')} />}>
                        <SpeedBots />
                    </Suspense>
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
                {TABS.map(({ flies, id, label, trailing }) => (
                    <button
                        key={id}
                        type='button'
                        className={`mw-trading-bots__tab${active_tab === id ? ' mw-trading-bots__tab--active' : ''}`}
                        aria-current={active_tab === id}
                        onClick={() => setActiveTab(id)}
                    >
                        <PuzzleIcon className='mw-trading-bots__tab-icon' />
                        {label}
                        {trailing && (
                            <span
                                className={`mw-trading-bots__tab-trailing${
                                    flies ? ' mw-trading-bots__tab-trailing--flies' : ''
                                }`}
                                aria-hidden='true'
                            >
                                {trailing}
                            </span>
                        )}
                    </button>
                ))}
            </nav>

            <div className='mw-trading-bots__panel'>{renderPanel()}</div>
        </div>
    );
});

export default TradingBots;
