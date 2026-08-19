import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { load, save_types } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import './free-bots.scss';

interface Bot {
    id: string;
    name: string;
    description: string;
    fileName: string;
    category: string;
    icon: string;
}

const BOTS: Bot[] = [
    {
        id: '1',
        name: 'Expert Speed Bot',
        description: 'Advanced speed trading bot with optimized entry and exit points for quick trades.',
        fileName: '2_2025_Updated_Expert_Speed_Bot_Version_📉📉📉📈📈📈_1_1_1765711647656.xml',
        category: 'Speed Trading',
        icon: '⚡',
    },
    {
        id: '2',
        name: 'Candle Mine Bot',
        description: 'Analyzes candlestick patterns to identify profitable trading opportunities.',
        fileName: '3_2025_Updated_Version_Of_Candle_Mine🇬🇧_1765711647657.xml',
        category: 'Pattern Analysis',
        icon: '🕯️',
    },
    {
        id: '3',
        name: 'Accumulators Pro Bot',
        description: 'Professional accumulator strategy bot for consistent growth trading.',
        fileName: 'Accumulators_Pro_Bot_1765711647657.xml',
        category: 'Accumulators',
        icon: '📈',
    },
    {
        id: '4',
        name: 'AI Entry Point Bot',
        description: 'AI-powered bot that identifies optimal entry points for maximum profit.',
        fileName: 'AI_with_Entry_Point_1765711647658.xml',
        category: 'AI Trading',
        icon: '🤖',
    },
    {
        id: '5',
        name: 'Alex Speed Bot EXPRO2',
        description: 'Enhanced speed trading bot with advanced algorithms for rapid execution.',
        fileName: 'ALEXSPEEDBOT__EXPRO2_(2)_(1)_1765711647659.xml',
        category: 'Speed Trading',
        icon: '🚀',
    },
    {
        id: '6',
        name: 'Alpha Bot Version 2026',
        description: 'Digits Over on Volatility 100 with staged recovery, profit target and stop loss.',
        fileName: 'Alpha_Bot_Version_2026.xml',
        category: 'AI Trading',
        icon: '🎯',
    },
    {
        id: '7',
        name: 'Auto C4 Volt Premium',
        description: 'Premium automated trading bot with advanced market analysis features.',
        fileName: 'AUTO_C4_VOLT_🇬🇧_2_🇬🇧_AI_PREMIUM_ROBOT_(2)_(1)_1765711647660.xml',
        category: 'Premium',
        icon: '⚡',
    },
    {
        id: '8',
        name: 'Binary Flipper AI Plus',
        description: 'AI-enhanced binary options trading bot with flip strategy optimization.',
        fileName: 'BINARY_FLIPPER_AI_ROBOT_PLUS_+_1765711647660.xml',
        category: 'AI Trading',
        icon: '🔄',
    },
    {
        id: '9',
        name: 'Binarytool Wizard AI',
        description: 'Intelligent trading wizard with multiple strategy implementations.',
        fileName: 'BINARYTOOL_WIZARD_AI_BOT_1765711647661.xml',
        category: 'AI Trading',
        icon: '🧙',
    },
    {
        id: '10',
        name: 'Binarytool Differ V2.0',
        description: 'Version 2.0 differ bot with improved accuracy and performance.',
        fileName: 'BINARYTOOL@_DIFFER_V2.0_(1)_(1)_1765711647662.xml',
        category: 'Differ',
        icon: '📊',
    },
    {
        id: '11',
        name: 'Even Odd Thunder AI Pro',
        description: 'Professional even/odd prediction bot with thunder-fast execution.',
        fileName: 'BINARYTOOL@EVEN_ODD_THUNDER_AI_PRO_BOT_1765711647662.xml',
        category: 'Even/Odd',
        icon: '⚡',
    },
    {
        id: '12',
        name: 'Even & Odd AI Bot',
        description: 'Smart AI bot specialized in even and odd digit predictions.',
        fileName: 'BINARYTOOL@EVEN&ODD_AI_BOT_(2)_1765711647663.xml',
        category: 'Even/Odd',
        icon: '🎲',
    },
];

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
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [search_term, setSearchTerm] = useState<string>('');

    const bots_in_scope = allowed_categories?.length
        ? BOTS.filter(bot => allowed_categories.includes(bot.category))
        : BOTS;

    const categories = ['All', ...Array.from(new Set(bots_in_scope.map(bot => bot.category)))];

    const normalized_search = search_term.trim().toLowerCase();

    const filteredBots = bots_in_scope.filter(bot => {
        const matches_category = selectedCategory === 'All' || bot.category === selectedCategory;
        const matches_search =
            !normalized_search ||
            bot.name.toLowerCase().includes(normalized_search) ||
            bot.description.toLowerCase().includes(normalized_search) ||
            bot.category.toLowerCase().includes(normalized_search);
        return matches_category && matches_search;
    });

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

            // Ensure we are on the bot builder tab and workspace is ready
            if (!(window as any).Blockly?.derivWorkspace) {
                dashboard?.setActiveTab(1);
                window.location.hash = 'bot_builder';
                // Give it some time to initialize the workspace
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            const workspace = (window as any).Blockly?.derivWorkspace;

            if (!workspace) {
                throw new Error('Bot Builder workspace not found. Please try again.');
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
            <div className='free-bots__header'>
                <h1 className='free-bots__title'>{title ?? 'Free Trading Bots'}</h1>
                <p className='free-bots__subtitle'>
                    {subtitle ??
                        'Explore our collection of pre-built trading bots. Click on any bot to load it into the Bot Builder.'}
                </p>
            </div>

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

            <div className='free-bots__categories'>
                {categories.map(category => (
                    <button
                        key={category}
                        className={`free-bots__category-btn ${selectedCategory === category ? 'free-bots__category-btn--active' : ''}`}
                        onClick={() => setSelectedCategory(category)}
                    >
                        {category}
                    </button>
                ))}
            </div>

            {filteredBots.length === 0 && (
                <div className='free-bots__empty'>
                    <span className='free-bots__empty-icon'>🔍</span>
                    <p>
                        No bots match “{search_term}”{selectedCategory !== 'All' ? ` in ${selectedCategory}` : ''}.
                    </p>
                </div>
            )}

            <div className='free-bots__grid'>
                {filteredBots.map(bot => (
                    <div key={bot.id} className='free-bots__card'>
                        <div className='free-bots__card-header'>
                            <span className='free-bots__card-icon'>{bot.icon}</span>
                            <span className='free-bots__card-category'>{bot.category}</span>
                        </div>
                        <h3 className='free-bots__card-title'>{bot.name}</h3>
                        <p className='free-bots__card-description'>{bot.description}</p>
                        <button
                            className='free-bots__card-btn'
                            onClick={() => loadBot(bot)}
                            disabled={loadingBotId === bot.id}
                        >
                            {loadingBotId === bot.id ? (
                                <span className='free-bots__card-btn-loading'>Loading...</span>
                            ) : (
                                <>
                                    <span>Load Bot</span>
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
