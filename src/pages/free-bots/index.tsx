import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { load, save_types } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { waitForDerivWorkspace } from '@/utils/wait-for-workspace';
import './free-bots.scss';

export interface Bot {
    id: string;
    name: string;
    description: string;
    fileName: string;
    category: string;
    icon: string;
    /**
     * Marks a bot as featured: the card gets the PREMIUM ribbon, a rating row
     * and its own call to action. Optional, so the other cards keep exactly
     * the layout they already had - the badge only means something as long as
     * it is the exception.
     */
    is_premium?: boolean;
    /** 0-5, shown as stars on premium cards. */
    rating?: number;
    /**
     * The two badges a Scalper Bots card carries - contract duration and the
     * contract it takes, e.g. '1 tick' and 'Digit odd'.
     *
     * Declared here rather than parsed out of the strategy because the nine
     * scalper XMLs are byte-identical: reading them would put the same badge
     * on all nine. They describe what each bot is meant to take, so they will
     * only match the file once the files themselves differ.
     */
    duration?: string;
    contract?: string;
}

/**
 * The one catalogue. Free Bots, its scoped views (Scalper/Speed/Strategies)
 * and the Bots Store all read this array rather than keeping lists of their
 * own, so a bot added here shows up in each of them and every card in the app
 * points at a file that actually exists in public/bots.
 */
export const BOTS: Bot[] = [
    {
        id: '1',
        name: 'Expert Speed Bot V1 2026',
        description:
            'Expert Speed Bot V1 2026 - Next-generation high-speed execution bot. Optimized for rapid trades with 2026 advanced profit strategies and smart risk management on Volatility 75 (1s).',
        fileName: '2_2025_Updated_Expert_Speed_Bot_Version_📉📉📉📈📈📈_1_1_1765711647656.xml',
        category: 'Speed Trading',
        icon: '🤖',
        is_premium: true,
        rating: 5,
    },
    {
        id: '4',
        name: 'AI Entry Point Bot',
        description:
            'AI Entry Point Bot - Premium entry-timing bot that waits for its target digit before committing, then trades instantly on Volatility 10 (1s).',
        fileName: 'AI_with_Entry_Point_1765711647658.xml',
        category: 'AI Trading',
        icon: '🤖',
        is_premium: true,
        rating: 5,
    },
    {
        id: '6',
        name: 'Alpha Version 2026 Edition',
        description:
            'Alpha Version 2026 Edition - Premium trading bot with cutting-edge 2026 algorithms. Features advanced market analysis and automated execution on Volatility 100 (1s).',
        fileName: 'Alpha_Bot_Version_2026.xml',
        category: 'AI Trading',
        icon: '🤖',
        is_premium: true,
        rating: 5,
    },
    {
        id: 'supatrader',
        name: 'Supatrader',
        description:
            'Supatrader - Premium Over & Under Bot. Advanced automated Over/Under trading bot running on Volatility 100 (1s).',
        fileName: 'Supatrader.xml',
        category: 'Over/Under',
        icon: '🤖',
        is_premium: true,
        rating: 5,
    },
    {
        id: 'dollar-printer-11',
        name: 'DOLLAR PRINTER BOT11',
        description:
            'Professional Dollar Printer bot version 11. Advanced automated trading system designed for consistent profits with intelligent risk management on Volatility 100 (1s).',
        fileName: 'Dollar_Printer_Bot11.xml',
        category: 'Over/Under',
        icon: '🤖',
        is_premium: true,
        rating: 5,
    },
    {
        id: '7',
        name: 'Maziwa Auto Premium',
        description:
            'Maziwa Auto Premium - Automated trading bot with advanced market analysis, running on Volatility 10 (1s) for rapid execution.',
        fileName: 'AUTO_C4_VOLT_🇬🇧_2_🇬🇧_AI_PREMIUM_ROBOT_(2)_(1)_1765711647660.xml',
        category: 'Premium',
        icon: '⚡',
        is_premium: true,
        rating: 5,
    },
    {
        id: 'dalembert-premium',
        name: "D'Alembert Premium Bot",
        description:
            "D'Alembert Premium Bot - Rise/Fall bot on Volatility 100 (1s) using D'Alembert staking: the stake steps up one unit after a loss and back down after a win. Asks for your trade amount, profit target and maximum loss on the first run, then ends the session as soon as either threshold is reached.",
        fileName: 'D_Alembert_Premium_Bot.xml',
        category: 'Premium',
        icon: '⚡',
        is_premium: true,
        rating: 5,
    },
    // The scalpers. Each points at its own file so any one can be replaced on
    // its own.
    //
    // All nine XMLs as supplied are byte-identical - one MD5 across the whole
    // set - so today every one of these loads the same strategy: an entry-point
    // prompt, then digits > over/under on 1HZ10V, contract type "both", with
    // Stake 5, Win Stake 5, Expected Profit 20, Stop Loss 100 and max losses 6.
    // The duration/contract badges below therefore say what each bot is meant
    // to take, not what its current file does. Drop a real ODD_SCALPER.xml over
    // public/bots/ODD_SCALPER.xml and only that card changes.
    {
        id: 'even-scalper',
        name: 'Even Scalper',
        description: 'High-speed even-digit scalper. Trades every tick on volatility indices with martingale recovery.',
        fileName: 'EVEN_SCALPER.xml',
        category: 'Even/Odd',
        icon: '⚡',
        duration: '1 tick',
        contract: 'Digit even',
    },
    {
        id: 'odd-scalper',
        name: 'Odd Scalper',
        description: 'High-speed odd-digit scalper. Trades every tick on volatility indices with martingale recovery.',
        fileName: 'ODD_SCALPER.xml',
        category: 'Even/Odd',
        icon: '⚡',
        duration: '1 tick',
        contract: 'Digit odd',
    },
    {
        id: 'even-multiple-scalper',
        name: 'Even Multiple Scalper',
        description: 'Multi-market even scalper with volatility switching and 1-tick execution speed.',
        fileName: 'EVEN_MULTIPLE_SCALPER.xml',
        category: 'Even/Odd',
        icon: '⚡',
        duration: '1 tick',
        contract: 'Digit even',
    },
    {
        id: 'odd-multiple-scalper',
        name: 'Odd Multiple Scalper',
        description: 'Multi-market odd scalper with volatility switching and 1-tick execution speed.',
        fileName: 'ODD_MULTIPLE_SCALPER.xml',
        category: 'Even/Odd',
        icon: '⚡',
        duration: '1 tick',
        contract: 'Digit odd',
    },
    {
        id: 'over-2-scalper',
        name: 'Over 2 Scalper',
        description: 'Digits-over-2 scalper. Trades every tick on volatility indices with martingale recovery.',
        fileName: 'OVER_2_SCALPER.xml',
        category: 'Over/Under',
        icon: '⚡',
        duration: '1 tick',
        contract: 'Digits over 2',
    },
    {
        id: 'under-5-scalper',
        name: 'Under 5 Scalper',
        description: 'Digits-under-5 scalper. Trades every tick on volatility indices with martingale recovery.',
        fileName: 'UNDER_5_SCALPER.xml',
        category: 'Over/Under',
        icon: '⚡',
        duration: '1 tick',
        contract: 'Digits under 5',
    },
    {
        id: 'under-7-scalper',
        name: 'Under 7 Scalper',
        description: 'Digits-under-7 scalper. Trades every tick on volatility indices with martingale recovery.',
        fileName: 'UNDER_7_SCALPER.xml',
        category: 'Over/Under',
        icon: '⚡',
        duration: '1 tick',
        contract: 'Digits under 7',
    },
    {
        id: 'rise-scalper',
        name: 'Rise Scalper',
        description: 'Rise scalper. Trades every tick on volatility indices with martingale recovery.',
        fileName: 'RISE_SCALPER.xml',
        category: 'Rise/Fall',
        icon: '⚡',
        duration: '1 tick',
        contract: 'Rise',
    },
    {
        id: 'fall-scalper',
        name: 'Fall Scalper',
        description: 'Fall scalper. Trades every tick on volatility indices with martingale recovery.',
        fileName: 'FALL_SCALPER.xml',
        category: 'Rise/Fall',
        icon: '⚡',
        duration: '1 tick',
        contract: 'Fall',
    },
    {
        id: 'signalsniper-autobot',
        name: 'SignalSniper AutoBot (1)',
        description:
            'Signal Sniper AutoBot - Automated signal detection and execution. Captures trading opportunities instantly with intelligent pattern recognition.',
        fileName: 'SignalSniper_AutoBot.xml',
        category: 'Even/Odd',
        // The same robot every other premium card carries. A dart set this one
        // apart in a grid whose whole point is that the cards read as one set.
        icon: '🤖',
        is_premium: true,
        rating: 5,
    },
    {
        id: '11',
        name: 'Even Odd Thunder AI Pro',
        description:
            'Even Odd Thunder AI Pro - Premium even/odd prediction bot with thunder-fast execution on Volatility 100 (1s).',
        fileName: 'BINARYTOOL@EVEN_ODD_THUNDER_AI_PRO_BOT_1765711647662.xml',
        category: 'Even/Odd',
        icon: '⚡',
        is_premium: true,
        rating: 5,
    },
];

/**
 * The scalpers, which are listed on their own page.
 *
 * They stay in this one catalogue - Scalper Bots reads it, and their files and
 * badges live here with every other bot - but they are kept out of Free Bots
 * and the Bots Store, so the same nine cards are not repeated under three tabs.
 *
 * Recognised by the id suffix every one of them carries, so a tenth scalper
 * added to the catalogue needs nothing here.
 */
export const isScalper = (bot: Bot) => bot.id.endsWith('-scalper');

export type TFreeBotsProps = {
    /**
     * Restricts the catalogue to these categories. Used by the Trading Bots
     * sub-tabs (Scalper/Speed/Strategies), each of which is a scoped view of
     * this same catalogue rather than a separate list to keep in sync.
     */
    allowed_categories?: string[];
    subtitle?: string;
    title?: string;
};

const FreeBots = observer(({ allowed_categories, subtitle, title }: TFreeBotsProps = {}) => {
    // useStore() is null for one render on a hard/direct load of this
    // standalone route - StoreProvider's init effect hasn't committed yet -
    // and an unguarded destructure here throws during render, which React
    // has no ErrorBoundary to recover from and unmounts the whole tree.
    const { dashboard } = useStore() ?? {};
    const [loadingBotId, setLoadingBotId] = useState<string | null>(null);
    const [search_term, setSearchTerm] = useState<string>('');

    // allowed_categories still scopes the catalogue - that is how Trading Bots
    // shows only its own section. What is gone is the row of category pills the
    // reader could click; search covers the same ground, category included.
    //
    // The scalpers are never listed here: they have a page of their own, and
    // were appearing on both.
    const listed = BOTS.filter(bot => !isScalper(bot));
    const bots_in_scope = allowed_categories?.length
        ? listed.filter(bot => allowed_categories.includes(bot.category))
        : listed;

    const normalized_search = search_term.trim().toLowerCase();

    const filteredBots = bots_in_scope.filter(
        bot =>
            !normalized_search ||
            bot.name.toLowerCase().includes(normalized_search) ||
            bot.description.toLowerCase().includes(normalized_search) ||
            bot.category.toLowerCase().includes(normalized_search)
    );

    const loadBot = async (bot: Bot) => {
        try {
            setLoadingBotId(bot.id);

            // These filenames contain '@', '&', '+', parentheses and emoji.
            // Unencoded they survive the dev server but not every static host:
            // '+' in particular is commonly decoded back to a space, which
            // turns into a 404 that reads as "this bot is broken". Encoding
            // the segment makes the request unambiguous everywhere.
            const response = await fetch(`/bots/${encodeURIComponent(bot.fileName)}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch bot file (HTTP ${response.status})`);
            }

            const xmlContent = await response.text();

            // Ensure we are on the bot builder tab and the workspace is ready.
            // Waits for the workspace to appear rather than sleeping a fixed
            // 1500ms and hoping: that was too short on a cold start, which is
            // what made loading a bot fail intermittently, and pure dead time
            // once Bot Builder was already up.
            if (!(window as any).Blockly?.derivWorkspace) {
                dashboard?.setActiveTab(1);
                window.location.hash = 'bot_builder';
            }

            const workspace = await waitForDerivWorkspace();

            if (!workspace) {
                throw new Error('Bot Builder did not finish loading. Please try again.');
            }

            await load({
                block_string: xmlContent,
                file_name: bot.name,
                workspace,
                from: save_types.LOCAL,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });

            dashboard.setActiveTab(1);
            window.location.hash = 'bot_builder';
        } catch (error: any) {
            console.error('Error loading bot:', error);
            // If it's the specific XML error, we can give a better hint
            if (error?.message?.includes('unsupported elements')) {
                alert(
                    'This bot contains elements that are not supported in the current version. Some blocks might be missing.'
                );
            } else {
                alert(`Failed to load bot: ${error?.message || 'Unknown error'}`);
            }
        } finally {
            setLoadingBotId(null);
        }
    };

    return (
        <div className='free-bots'>
            {/* Only the scoped views name themselves. On the Free Bots tab the
                header said "Free Trading Bots" directly under a tab already
                reading "Free Bots", above a page that is visibly a grid of
                bots - a heading, a subtitle and a paragraph of instructions for
                something the screen was already showing. The callers that do
                pass a title (Scalper Bots, SpeedBots, Strategies) still get
                one, because there the name says which slice of the catalogue
                is on screen. */}
            {(title || subtitle) && (
                <div className='free-bots__header'>
                    {title && <h1 className='free-bots__title'>{title}</h1>}
                    {subtitle && <p className='free-bots__subtitle'>{subtitle}</p>}
                </div>
            )}

            <div className='free-bots__search'>
                <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                    <circle cx='11' cy='11' r='8' />
                    <path d='m21 21-4.35-4.35' />
                </svg>
                <input
                    type='text'
                    className='free-bots__search-input'
                    placeholder='Search bots by name, strategy or category...'
                    value={search_term}
                    onChange={event => setSearchTerm(event.target.value)}
                    aria-label='Search bots'
                />
                {search_term && (
                    <button
                        type='button'
                        className='free-bots__search-clear'
                        onClick={() => setSearchTerm('')}
                        aria-label='Clear search'
                    >
                        ✕
                    </button>
                )}
            </div>

            {filteredBots.length === 0 && (
                <div className='free-bots__empty'>
                    <span className='free-bots__empty-icon'>🔍</span>
                    <p>No bots match “{search_term}”.</p>
                </div>
            )}

            <div className='free-bots__grid'>
                {filteredBots.map(bot => (
                    <div key={bot.id} className={`free-bots__card ${bot.is_premium ? 'free-bots__card--premium' : ''}`}>
                        {bot.is_premium && <span className='free-bots__ribbon'>Premium</span>}
                        <div className='free-bots__card-header'>
                            <span className='free-bots__card-icon'>{bot.icon}</span>
                            {/* The ribbon already occupies this corner on a
                                premium card, and two badges side by side read
                                as clutter rather than emphasis. */}
                            {!bot.is_premium && <span className='free-bots__card-category'>{bot.category}</span>}
                        </div>
                        <h3 className='free-bots__card-title'>{bot.name}</h3>
                        {bot.is_premium && bot.rating ? (
                            <div className='free-bots__rating' role='img' aria-label={`Rated ${bot.rating} out of 5`}>
                                {Array.from({ length: 5 }, (_, index) => (
                                    <span
                                        key={index}
                                        aria-hidden='true'
                                        className={`free-bots__star ${index < (bot.rating ?? 0) ? 'free-bots__star--on' : ''}`}
                                    >
                                        ★
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        <p className='free-bots__card-description'>{bot.description}</p>
                        <button
                            className={`free-bots__card-btn ${bot.is_premium ? 'free-bots__card-btn--premium' : ''}`}
                            onClick={() => loadBot(bot)}
                            disabled={loadingBotId === bot.id}
                        >
                            {loadingBotId === bot.id ? (
                                <span className='free-bots__card-btn-loading'>Loading...</span>
                            ) : (
                                <>
                                    <span>{bot.is_premium ? 'Load Premium Bot' : 'Load Bot'}</span>
                                    {/* The premium button is a full-width label
                                        rather than a label plus arrow - the
                                        arrow reads as "next" and competes with
                                        the wording. */}
                                    {!bot.is_premium && (
                                        <svg
                                            width='16'
                                            height='16'
                                            viewBox='0 0 24 24'
                                            fill='none'
                                            stroke='currentColor'
                                            strokeWidth='2'
                                        >
                                            <path d='M5 12h14M12 5l7 7-7 7' />
                                        </svg>
                                    )}
                                </>
                            )}
                        </button>
                    </div>
                ))}
            </div>

            <div className='free-bots__footer'>
                <p>All bots are provided for educational purposes. Always test with demo accounts first.</p>
            </div>
        </div>
    );
});

export default FreeBots;
