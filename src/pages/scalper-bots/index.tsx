import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { load, save_types } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { type Bot, BOTS } from '../free-bots';
import './scalper-bots.scss';

/**
 * Scalper Bots: the digit-market bots from the one catalogue in ../free-bots,
 * presented as a list you can open.
 *
 * Every value on screen is read from the strategy's own XML - market, symbol,
 * trade type, contract type, candle interval - rather than described from
 * memory. A card that cannot be parsed says so instead of showing blanks, and
 * nothing here invents a take-profit, a stop-loss or a recovery rule that the
 * file does not contain.
 *
 * Start hands the loaded strategy to the run panel's existing onRunButtonClick
 * - the same path the Run control uses. It places trades, which is why it is
 * on a button the person presses and never fires on its own.
 */

/** Categories that are digit scalping. 'Differ' used to be listed here and matches no bot. */
const SCALPER_CATEGORIES = ['Even/Odd', 'Over/Under', 'Rise/Fall'];

type TParams = {
    market?: string;
    submarket?: string;
    symbol?: string;
    trade_type_category?: string;
    trade_type?: string;
    contract_type?: string;
    candle_interval?: string;
    /** Variable name -> its first assigned number, from the strategy's own blocks. */
    settings?: Array<[string, string]>;
};

/**
 * The numbers a strategy sets once at start - Stake, Stop Loss, max losses and
 * so on. Read from the first `variables_set` holding a plain number for each
 * name, which is the "Run once at start" block; later assignments are the
 * strategy moving them around at runtime and are not settings.
 */
const SETTING_ORDER = ['Stake', 'Win Stake', 'Expected Profit', 'Stop Loss', 'maxLosses', 'tradesNo'];

const parseSettings = (xml: string): Array<[string, string]> => {
    const found = new Map<string, string>();
    const pattern =
        /<block type="variables_set"[^>]*>\s*<field name="VAR"[^>]*>([^<]*)<\/field>\s*<value name="VALUE">\s*<block type="math_number"[^>]*>\s*<field name="NUM">([^<]*)<\/field>/g;
    for (const match of xml.matchAll(pattern)) {
        const name = match[1].trim();
        if (!found.has(name)) found.set(name, match[2].trim());
    }
    return SETTING_ORDER.filter(name => found.has(name)).map(name => [name, found.get(name) as string]);
};

/** Reads the first value of each trade-definition field out of a strategy's XML. */
const parseParams = (xml: string): TParams => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return {};
    const field = (name: string) => doc.querySelector(`field[name="${name}"]`)?.textContent?.trim() || undefined;
    return {
        market: field('MARKET_LIST'),
        submarket: field('SUBMARKET_LIST'),
        symbol: field('SYMBOL_LIST'),
        trade_type_category: field('TRADETYPECAT_LIST'),
        trade_type: field('TRADETYPE_LIST'),
        contract_type: field('TYPE_LIST'),
        candle_interval: field('CANDLEINTERVAL_LIST'),
        settings: parseSettings(xml),
    };
};

const prettify = (value?: string) =>
    value ? value.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase()) : '';

const candleLabel = (seconds?: string) => {
    const value = Number(seconds);
    if (!value || Number.isNaN(value)) return '';
    if (value % 3600 === 0) return localize('{{count}} hour', { count: value / 3600 });
    if (value % 60 === 0) return localize('{{count}} minute', { count: value / 60 });
    return localize('{{count}} second', { count: value });
};

const ScalperBots = observer(() => {
    const { dashboard, run_panel } = useStore();
    const [search_term, setSearchTerm] = useState('');
    const [active_filter, setActiveFilter] = useState<string | null>(null);
    const [open_bot, setOpenBot] = useState<Bot | null>(null);
    const [params, setParams] = useState<Record<string, TParams>>({});
    const [busy_id, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [panel_open, setPanelOpen] = useState<Record<string, boolean>>({ shared: true, settings: true });

    const bots = useMemo(() => BOTS.filter(bot => SCALPER_CATEGORIES.includes(bot.category)), []);
    const filters = useMemo(() => [...new Set(bots.map(bot => bot.category))], [bots]);

    // Each bot's real parameters, read once from its own file. A bot whose XML
    // will not parse simply has no entry, and the UI says so rather than
    // filling the gap.
    useEffect(() => {
        let cancelled = false;
        Promise.all(
            bots.map(async bot => {
                try {
                    const response = await fetch(`/bots/${encodeURIComponent(bot.fileName)}`);
                    if (!response.ok) return [bot.id, {}] as const;
                    return [bot.id, parseParams(await response.text())] as const;
                } catch {
                    return [bot.id, {}] as const;
                }
            })
        ).then(entries => {
            if (!cancelled) setParams(Object.fromEntries(entries));
        });
        return () => {
            cancelled = true;
        };
    }, [bots]);

    const normalized = search_term.trim().toLowerCase();
    const visible = bots.filter(
        bot =>
            (!active_filter || bot.category === active_filter) &&
            (!normalized ||
                bot.name.toLowerCase().includes(normalized) ||
                bot.description.toLowerCase().includes(normalized))
    );

    /** Loads the strategy into the Bot Builder workspace. Does not trade. */
    const loadIntoWorkspace = async (bot: Bot) => {
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
    };

    const handleLoad = async (bot: Bot) => {
        try {
            setError(null);
            setBusyId(bot.id);
            await loadIntoWorkspace(bot);
            dashboard.setActiveTab(1);
            window.location.hash = 'bot_builder';
        } catch (load_error: any) {
            setError(load_error?.message || localize('Could not load that bot.'));
        } finally {
            setBusyId(null);
        }
    };

    // Loads the strategy and hands it to the run panel's own run action. This
    // buys contracts with real money, which is why it lives behind a button
    // and never runs by itself.
    const handleStart = async (bot: Bot) => {
        try {
            setError(null);
            setBusyId(bot.id);
            await loadIntoWorkspace(bot);
            await run_panel.onRunButtonClick();
        } catch (run_error: any) {
            setError(run_error?.message || localize('Could not start that bot.'));
        } finally {
            setBusyId(null);
        }
    };

    const togglePanel = (key: string) => setPanelOpen(state => ({ ...state, [key]: !state[key] }));

    if (open_bot) {
        const detail = params[open_bot.id] ?? {};
        const settings = detail.settings ?? [];
        const has_params = Boolean(detail.market || detail.symbol || detail.trade_type);
        const all_rows: Array<[string, string]> = [
            [localize('Market'), [prettify(detail.market), prettify(detail.submarket)].filter(Boolean).join(' › ')],
            [localize('Symbol'), detail.symbol ?? ''],
            [
                localize('Trade type'),
                [prettify(detail.trade_type_category), prettify(detail.trade_type)].filter(Boolean).join(' › '),
            ],
            [localize('Contract type'), detail.contract_type ?? ''],
            [localize('Candle interval'), candleLabel(detail.candle_interval)],
        ];
        // A row the file has nothing to say about is dropped rather than shown
        // empty.
        const rows = all_rows.filter(([, value]) => Boolean(value));

        return (
            <div className='mw-scalp mw-scalp--detail'>
                <div className='mw-scalp__detail-head'>
                    <div>
                        <h1 className='mw-scalp__detail-title'>{open_bot.name}</h1>
                        <p className='mw-scalp__status'>
                            {run_panel.is_running ? localize('Status: running') : localize('Status: stopped')}
                        </p>
                    </div>
                    <button
                        type='button'
                        className='mw-scalp__start'
                        onClick={() => handleStart(open_bot)}
                        disabled={busy_id === open_bot.id || run_panel.is_running}
                    >
                        {busy_id === open_bot.id ? localize('Starting...') : localize('Start')}
                    </button>
                </div>

                <button type='button' className='mw-scalp__back' onClick={() => setOpenBot(null)}>
                    {localize('Back to bots menu')}
                </button>

                {error && (
                    <p className='mw-scalp__error' role='alert'>
                        {error}
                    </p>
                )}

                <div className='mw-scalp__actions'>
                    <button
                        type='button'
                        className='mw-scalp__action mw-scalp__action--load'
                        onClick={() => handleLoad(open_bot)}
                        disabled={busy_id === open_bot.id}
                    >
                        {localize('Open in Bot Builder')}
                    </button>
                    <a
                        className='mw-scalp__action mw-scalp__action--download'
                        href={`/bots/${encodeURIComponent(open_bot.fileName)}`}
                        download
                    >
                        {localize('Download')}
                    </a>
                </div>

                <section className='mw-scalp__panel'>
                    <button
                        type='button'
                        className='mw-scalp__panel-head'
                        onClick={() => togglePanel('shared')}
                        aria-expanded={!!panel_open.shared}
                    >
                        {localize('Trade parameters')}
                        <span aria-hidden='true'>{panel_open.shared ? '−' : '+'}</span>
                    </button>
                    {panel_open.shared && (
                        <div className='mw-scalp__panel-body'>
                            {/* Read out of the strategy file itself, so what is
                                shown is what the bot will actually trade. */}
                            {has_params ? (
                                rows.map(([label, value]) => (
                                    <div className='mw-scalp__row' key={label}>
                                        <span>{label}</span>
                                        <strong>{value}</strong>
                                    </div>
                                ))
                            ) : (
                                <p className='mw-scalp__muted'>
                                    {localize("This bot's parameters could not be read from its file.")}
                                </p>
                            )}
                        </div>
                    )}
                </section>

                {settings.length > 0 && (
                    <section className='mw-scalp__panel'>
                        <button
                            type='button'
                            className='mw-scalp__panel-head'
                            onClick={() => togglePanel('settings')}
                            aria-expanded={!!panel_open.settings}
                        >
                            {localize('Strategy settings')}
                            <span aria-hidden='true'>{panel_open.settings ? '−' : '+'}</span>
                        </button>
                        {panel_open.settings && (
                            <div className='mw-scalp__panel-body'>
                                {/* The values the strategy assigns once at
                                    start, under the names it uses for them. */}
                                {settings.map(([name, value]) => (
                                    <div className='mw-scalp__row' key={name}>
                                        <span>{name}</span>
                                        <strong>{value}</strong>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                <p className='mw-scalp__note'>{open_bot.description}</p>
            </div>
        );
    }

    return (
        <div className='mw-scalp'>
            <header className='mw-scalp__banner'>
                <span className='mw-scalp__banner-icon' aria-hidden='true'>
                    ⚡
                </span>
                <p className='mw-scalp__banner-text'>
                    <strong>{localize('Scalper Bots')}</strong>{' '}
                    {localize('Digit-market bots from your library, with their parameters read from each file.')}
                </p>
            </header>

            <input
                type='text'
                className='mw-scalp__search'
                placeholder={localize('Search bots...')}
                value={search_term}
                onChange={event => setSearchTerm(event.target.value)}
                aria-label={localize('Search bots')}
            />

            <div className='mw-scalp__pills'>
                <button
                    type='button'
                    className={`mw-scalp__pill${active_filter === null ? ' mw-scalp__pill--active' : ''}`}
                    onClick={() => setActiveFilter(null)}
                >
                    {localize('All')}
                </button>
                {filters.map(name => (
                    <button
                        key={name}
                        type='button'
                        className={`mw-scalp__pill${active_filter === name ? ' mw-scalp__pill--active' : ''}`}
                        onClick={() => setActiveFilter(active_filter === name ? null : name)}
                    >
                        {name}
                    </button>
                ))}
            </div>

            {error && (
                <p className='mw-scalp__error' role='alert'>
                    {error}
                </p>
            )}

            {visible.length === 0 && <p className='mw-scalp__muted'>{localize('No bots match that search.')}</p>}

            <div className='mw-scalp__grid'>
                {visible.map(bot => {
                    const detail = params[bot.id] ?? {};
                    return (
                        <article className='mw-scalp__card' key={bot.id}>
                            {/* Duration and contract, as declared on the bot.
                                Falls back to the category and the symbol read
                                from the file for anything without them. */}
                            <div className='mw-scalp__badges'>
                                <span className='mw-scalp__badge mw-scalp__badge--a'>
                                    {bot.duration ?? bot.category}
                                </span>
                                {(bot.contract || detail.symbol) && (
                                    <span className='mw-scalp__badge mw-scalp__badge--b'>
                                        {bot.contract ?? detail.symbol}
                                    </span>
                                )}
                            </div>
                            <h3 className='mw-scalp__card-title'>{bot.name}</h3>
                            <p className='mw-scalp__card-description'>{bot.description}</p>
                            <div className='mw-scalp__card-actions'>
                                <button type='button' className='mw-scalp__card-btn' onClick={() => setOpenBot(bot)}>
                                    {localize('Open')}
                                </button>
                                <button
                                    type='button'
                                    className='mw-scalp__card-btn mw-scalp__card-btn--ghost'
                                    onClick={() => handleLoad(bot)}
                                    disabled={busy_id === bot.id}
                                >
                                    {busy_id === bot.id ? localize('Loading...') : localize('Load bot')}
                                </button>
                            </div>
                        </article>
                    );
                })}
            </div>
        </div>
    );
});

export default ScalperBots;
