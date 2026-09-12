import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { TradeTypeIcon } from '@/components/trade-type/trade-type-icon';
import { useTranslations } from '@deriv-com/translations';
import { findTradeType, TRADE_DESCRIPTIONS, TTradeType } from './trade-types';

/**
 * Deriv's trade-type picker: a "learn more" row, then the types grouped the way
 * Deriv groups them, each carrying its own artwork - the icons for the two
 * sides it is bought on, which is what Deriv puts beside them.
 *
 * One component for both shapes - the whole screen on a phone, a panel beside
 * the ticket on a desktop. The families and the search box belong to the
 * desktop one only, as they do on Deriv; dtrader.scss draws that part.
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

/** The two sides' icons, which is what Deriv shows against each type. */
const TypeIcons = ({ type }: { type: TTradeType }) => (
    <span className='mw-dt__types-icons'>
        {type.sides.map(side => (
            <TradeTypeIcon key={side.contract_type} type={side.contract_type} size='sm' />
        ))}
    </span>
);

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
    const [is_learning, setIsLearning] = useState(false);

    useEffect(() => {
        if (!is_open) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [is_open, onClose]);

    // The list comes back when the panel is opened again, rather than
    // reopening on whatever was last read.
    useEffect(() => {
        if (!is_open) setIsLearning(false);
    }, [is_open]);

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
                    <h2>{is_learning ? localize('Trade types') : localize('Trade types')}</h2>
                    <button
                        type='button'
                        className='mw-dt__types-close'
                        aria-label={localize('Close')}
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </header>

                {is_learning ? (
                    <div className='mw-dt__types-learn-view'>
                        <button type='button' className='mw-dt__types-back' onClick={() => setIsLearning(false)}>
                            {localize('Back to trade types')}
                        </button>
                        <div className='mw-dt__types-scroll'>
                            {GROUPS.flatMap(group => group.ids).map(id => {
                                const type = findTradeType(id);
                                return (
                                    <section key={id} className='mw-dt__types-about'>
                                        <h3>
                                            <TypeIcons type={type} />
                                            {localize(type.label)}
                                        </h3>
                                        <p>{localize(TRADE_DESCRIPTIONS[id] ?? '')}</p>
                                    </section>
                                );
                            })}
                        </div>
                    </div>
                ) : (
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

                            <button type='button' className='mw-dt__types-learn' onClick={() => setIsLearning(true)}>
                                <span>{localize('Learn more about trade types')}</span>
                                <i aria-hidden='true'>›</i>
                            </button>

                            <div className='mw-dt__types-scroll'>
                                {groups.length === 0 && (
                                    <p className='mw-dt__types-empty'>{localize('No trade types match that.')}</p>
                                )}
                                {groups.map(group => (
                                    <section key={group.label}>
                                        <h3>
                                            {localize(group.label)}
                                            {group.is_new && (
                                                <span className='mw-dt__types-new'>{localize('NEW!')}</span>
                                            )}
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
                                                        unavailable
                                                            ? localize('Not offered on this market.')
                                                            : undefined
                                                    }
                                                    onClick={() => {
                                                        onSelect(type.id);
                                                        onClose();
                                                    }}
                                                >
                                                    <TypeIcons type={type} />
                                                    <span>{localize(type.label)}</span>
                                                </button>
                                            );
                                        })}
                                    </section>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default TradeTypesPanel;
