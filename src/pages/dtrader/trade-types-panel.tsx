import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from '@deriv-com/translations';
import TradeIcon from './trade-icon';
import { findTradeType } from './trade-types';

/**
 * Deriv's trade-type picker: the families down the left, a search box, and the
 * types themselves grouped the way Deriv groups them.
 *
 * One component for both shapes - a panel over the page on a desktop, the
 * whole screen on a phone - because it is one list with one behaviour and only
 * its frame differs; dtrader.scss does that part.
 *
 * Rendered into <body>: the ticket scrolls its own overflow on the desktop
 * layout, so a panel opened from inside it would be clipped by the ticket's
 * edge.
 */

type TGroup = {
    family: 'accumulators' | 'multipliers' | 'options';
    /** Trade type ids, in the order Deriv lists them under the heading. */
    ids: string[];
    /** Deriv's own NEW! badge. */
    is_new?: boolean;
    label: string;
};

const GROUPS: TGroup[] = [
    { family: 'accumulators', ids: ['accumulators'], is_new: true, label: 'Accumulators' },
    { family: 'options', ids: ['vanillas'], is_new: true, label: 'Vanillas' },
    { family: 'options', ids: ['turbos'], is_new: true, label: 'Turbos' },
    { family: 'multipliers', ids: ['multipliers'], label: 'Multipliers' },
    { family: 'options', ids: ['rise_fall', 'higher_lower'], label: 'Ups & Downs' },
    { family: 'options', ids: ['touch_no_touch'], label: 'Touch & No Touch' },
    { family: 'options', ids: ['matches_differs', 'even_odd', 'over_under'], label: 'Digits' },
];

const FAMILIES = [
    { label: 'All', value: 'all' },
    { label: 'Multipliers', value: 'multipliers' },
    { label: 'Options', value: 'options' },
    { label: 'Accumulators', value: 'accumulators' },
];

type TTradeTypesPanelProps = {
    is_open: boolean;
    onClose: () => void;
    onSelect: (id: string) => void;
    /**
     * The contract categories this market actually offers, from Deriv's
     * contracts_for - null while that answer is still on its way. A type the
     * market cannot trade is shown greyed rather than hidden, so the list does
     * not change shape as you move between markets.
     */
    supported: Set<string> | null;
    type_id: string;
};

const TradeTypesPanel = ({ is_open, onClose, onSelect, supported, type_id }: TTradeTypesPanelProps) => {
    const { localize } = useTranslations();
    const [family, setFamily] = useState('all');
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (!is_open) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [is_open, onClose]);

    const groups = useMemo(() => {
        const query = search.trim().toLowerCase();
        return GROUPS.filter(group => family === 'all' || group.family === family)
            .map(group => ({
                ...group,
                types: group.ids
                    .map(id => findTradeType(id))
                    .filter(type => (query ? type.label.toLowerCase().includes(query) : true)),
            }))
            .filter(group => group.types.length > 0);
    }, [family, search]);

    if (!is_open) return null;

    return createPortal(
        <div className='mw-dt__sheet'>
            <button
                type='button'
                className='mw-dt__sheet-scrim'
                aria-label={localize('Close')}
                onClick={onClose}
                tabIndex={-1}
            />

            <div className='mw-dt__types-panel' role='dialog' aria-modal='true' aria-label={localize('Trade types')}>
                <header className='mw-dt__types-head'>
                    <h2>{localize('Trade types')}</h2>
                    <button
                        type='button'
                        className='mw-dt__types-close'
                        aria-label={localize('Close')}
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </header>

                <div className='mw-dt__types-body'>
                    <nav className='mw-dt__types-rail' aria-label={localize('Trade type families')}>
                        {FAMILIES.map(item => (
                            <button
                                key={item.value}
                                type='button'
                                className={`mw-dt__types-family${
                                    item.value === family ? ' mw-dt__types-family--on' : ''
                                }`}
                                aria-pressed={item.value === family}
                                onClick={() => setFamily(item.value)}
                            >
                                {localize(item.label)}
                            </button>
                        ))}
                    </nav>

                    <div className='mw-dt__types-list'>
                        <input
                            type='search'
                            className='mw-dt__types-search'
                            placeholder={localize('Search')}
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                        />

                        <div className='mw-dt__types-scroll'>
                            {groups.length === 0 && (
                                <p className='mw-dt__types-empty'>{localize('No trade types match that.')}</p>
                            )}
                            {groups.map(group => (
                                <section key={group.label}>
                                    <h3>
                                        {localize(group.label)}
                                        {group.is_new && <span className='mw-dt__types-new'>{localize('NEW!')}</span>}
                                    </h3>
                                    {group.types.map(type => {
                                        const unavailable = supported !== null && !supported.has(type.category);
                                        return (
                                            <button
                                                key={type.id}
                                                type='button'
                                                className={`mw-dt__types-item${
                                                    type.id === type_id ? ' mw-dt__types-item--on' : ''
                                                }`}
                                                disabled={unavailable}
                                                title={
                                                    unavailable ? localize('Not offered on this market.') : undefined
                                                }
                                                onClick={() => {
                                                    onSelect(type.id);
                                                    onClose();
                                                }}
                                            >
                                                <TradeIcon id={type.id} />
                                                <span>{localize(type.label)}</span>
                                            </button>
                                        );
                                    })}
                                </section>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default TradeTypesPanel;
