import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { load, save_types } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { type Bot, BOTS } from '../free-bots';
import './bots-store.scss';

/**
 * The Bots Store: the same library as Free Bots, grouped into named shelves
 * with a search and a row of filter chips.
 *
 * It groups by the catalogue's own `category`, because that is the only real
 * grouping this repo has - there is no store/vendor field on a bot and no
 * manifest that would supply one. Every card here therefore points at an XML
 * that exists in public/bots and loads for real; nothing is listed that
 * cannot be loaded. To carry vendor shelves instead, give Bot a `store` field
 * in ../free-bots and change GROUP_OF below to read it - the rest of this
 * file is written against the grouping function, not against `category`.
 */

/** The field the shelves are built from. One place to change. */
const GROUP_OF = (bot: Bot) => bot.category;

/**
 * Shelf colours, assigned by position so a given shelf keeps its colour as
 * long as the catalogue order is stable, and so a new one never lands
 * colourless.
 */
const PALETTE = ['#0f9b8e', '#d9342b', '#2f5fe0', '#7b3fe4', '#d97706', '#3f4fd4', '#0891b2', '#be185d'];

const BotsStore = observer(() => {
    const { dashboard } = useStore();
    const [search_term, setSearchTerm] = useState('');
    const [active_group, setActiveGroup] = useState<string | null>(null);
    const [loading_bot_id, setLoadingBotId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Built once from the catalogue: the shelves, in catalogue order, each
    // with the colour it will keep.
    const groups = useMemo(() => {
        const by_name = new Map<string, Bot[]>();
        BOTS.forEach(bot => {
            const name = GROUP_OF(bot);
            const existing = by_name.get(name);
            if (existing) existing.push(bot);
            else by_name.set(name, [bot]);
        });
        return [...by_name.entries()].map(([name, bots], index) => ({
            name,
            bots,
            colour: PALETTE[index % PALETTE.length],
        }));
    }, []);

    const normalized_search = search_term.trim().toLowerCase();

    // Search spans bot name and shelf name, which is what the search field
    // says it does. The chip narrows on top of it rather than instead of it.
    const visible_groups = groups
        .map(group => ({
            ...group,
            bots: group.bots.filter(
                bot =>
                    !normalized_search ||
                    bot.name.toLowerCase().includes(normalized_search) ||
                    group.name.toLowerCase().includes(normalized_search)
            ),
        }))
        .filter(group => group.bots.length > 0 && (!active_group || group.name === active_group));

    const total_bots = groups.reduce((sum, group) => sum + group.bots.length, 0);

    const loadBot = async (bot: Bot, group_name: string) => {
        try {
            setError(null);
            setLoadingBotId(bot.id);

            // Encoded because these filenames carry '@', '&', '+' and emoji -
            // '+' in particular is decoded back to a space by some static
            // hosts, which turns into a 404 that reads as a broken bot.
            const response = await fetch(`/bots/${encodeURIComponent(bot.fileName)}`);
            if (!response.ok) throw new Error(`Failed to fetch bot file (HTTP ${response.status})`);
            const xml_content = await response.text();

            if (!(window as any).Blockly?.derivWorkspace) {
                dashboard?.setActiveTab(1);
                window.location.hash = 'bot_builder';
                await new Promise(resolve => setTimeout(resolve, 1500));
            }

            const workspace = (window as any).Blockly?.derivWorkspace;
            if (!workspace) throw new Error('Bot Builder workspace not found. Please try again.');

            await load({
                block_string: xml_content,
                file_name: bot.name,
                workspace,
                from: save_types.LOCAL,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });

            dashboard.setActiveTab(1);
            window.location.hash = 'bot_builder';
        } catch (load_error: any) {
            // On the page rather than in an alert, so it sits next to the card
            // that failed instead of interrupting.
            setError(
                localize('Could not load {{bot}} from {{store}}: {{reason}}', {
                    bot: bot.name,
                    store: group_name,
                    reason: load_error?.message || localize('unknown error'),
                })
            );
        } finally {
            setLoadingBotId(null);
        }
    };

    return (
        <div className='mw-store'>
            <div className='mw-store__search'>
                <input
                    type='text'
                    className='mw-store__search-input'
                    placeholder={localize('Search by bot or store name')}
                    value={search_term}
                    onChange={event => setSearchTerm(event.target.value)}
                    aria-label={localize('Search by bot or store name')}
                />
                {search_term && (
                    <button
                        type='button'
                        className='mw-store__search-clear'
                        onClick={() => setSearchTerm('')}
                        aria-label={localize('Clear search')}
                    >
                        ✕
                    </button>
                )}
            </div>

            <div className='mw-store__chips' role='tablist' aria-label={localize('Stores')}>
                <button
                    type='button'
                    role='tab'
                    aria-selected={active_group === null}
                    className={`mw-store__chip${active_group === null ? ' mw-store__chip--active' : ''}`}
                    onClick={() => setActiveGroup(null)}
                >
                    {localize('All Stores')}
                    <span className='mw-store__chip-count'>{total_bots}</span>
                </button>
                {groups.map(group => (
                    <button
                        key={group.name}
                        type='button'
                        role='tab'
                        aria-selected={active_group === group.name}
                        className={`mw-store__chip${active_group === group.name ? ' mw-store__chip--active' : ''}`}
                        onClick={() => setActiveGroup(active_group === group.name ? null : group.name)}
                    >
                        <span className='mw-store__chip-dot' style={{ background: group.colour }} aria-hidden='true' />
                        {group.name}
                        <span className='mw-store__chip-count'>{group.bots.length}</span>
                    </button>
                ))}
            </div>

            {error && (
                <p className='mw-store__error' role='alert'>
                    {error}
                </p>
            )}

            {visible_groups.length === 0 && <p className='mw-store__empty'>{localize('No bots match that search.')}</p>}

            {visible_groups.map(group => (
                <section className='mw-store__shelf' key={group.name}>
                    <header className='mw-store__shelf-head'>
                        <span className='mw-store__shelf-dot' style={{ background: group.colour }} aria-hidden='true' />
                        <h2 className='mw-store__shelf-name'>{group.name}</h2>
                        <span className='mw-store__shelf-count'>{group.bots.length}</span>
                    </header>

                    <div className='mw-store__grid'>
                        {group.bots.map(bot => (
                            <article
                                className='mw-store__card'
                                key={bot.id}
                                style={{ '--shelf': group.colour } as React.CSSProperties}
                            >
                                <span className='mw-store__card-ribbon'>{group.name}</span>
                                <p className='mw-store__card-eyebrow'>{localize('Library bot')}</p>
                                <h3 className='mw-store__card-title'>
                                    <span className='mw-store__card-icon' aria-hidden='true'>
                                        {bot.icon}
                                    </span>
                                    {bot.name}
                                </h3>
                                <p className='mw-store__card-description'>
                                    {localize('Ready to load from {{store}} into your workspace in one click.', {
                                        store: group.name,
                                    })}
                                </p>
                                <button
                                    type='button'
                                    className='mw-store__card-btn'
                                    onClick={() => loadBot(bot, group.name)}
                                    disabled={loading_bot_id === bot.id}
                                >
                                    {loading_bot_id === bot.id ? localize('Loading...') : localize('Load bot')}
                                </button>
                            </article>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
});

export default BotsStore;
