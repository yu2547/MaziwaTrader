import { useTranslations } from '@deriv-com/translations';

/**
 * The contracts bought from this page, as they run and after they close.
 *
 * Everything shown is read off Deriv's own proposal_open_contract stream for
 * those contracts - the profit is the contract's profit, not a figure worked
 * out here - so a row is only as current as Deriv's last update, and a row
 * exists only because a contract was actually bought.
 */

export type TPosition = {
    buy_price?: number;
    contract_id: number;
    currency?: string;
    display_name?: string;
    is_sold?: boolean;
    longcode?: string;
    profit?: number;
    trade_label: string;
};

type TPositionsPanelProps = {
    is_collapsed: boolean;
    onDismiss: (contract_id: number) => void;
    onToggle: () => void;
    positions: TPosition[];
};

const money = (value: number | undefined, currency: string | undefined) =>
    `${(value ?? 0).toFixed(2)} ${currency ?? ''}`.trim();

const PositionsPanel = ({ is_collapsed, onDismiss, onToggle, positions }: TPositionsPanelProps) => {
    const { localize } = useTranslations();
    const open_count = positions.filter(position => !position.is_sold).length;
    const total = positions.reduce((sum, position) => sum + (position.profit ?? 0), 0);
    const currency = positions[0]?.currency;

    return (
        <aside className={`mw-dt__positions${is_collapsed ? ' mw-dt__positions--min' : ''}`}>
            <header className='mw-dt__positions-head'>
                <h2>{localize('Open positions')}</h2>
                <button type='button' onClick={onToggle} aria-label={localize('Collapse open positions')}>
                    {is_collapsed ? '+' : '–'}
                </button>
            </header>

            {!is_collapsed && (
                <>
                    <div className='mw-dt__positions-body'>
                        {positions.length === 0 && (
                            <div className='mw-dt__positions-empty'>
                                <span aria-hidden='true'>&#128188;</span>
                                <p>{localize('You have no open positions.')}</p>
                            </div>
                        )}

                        {positions.map(position => {
                            const profit = position.profit ?? 0;
                            return (
                                <article
                                    key={position.contract_id}
                                    className={`mw-dt__position${
                                        position.is_sold
                                            ? profit >= 0
                                                ? ' mw-dt__position--won'
                                                : ' mw-dt__position--lost'
                                            : ''
                                    }`}
                                >
                                    <header>
                                        <span>{position.display_name ?? ''}</span>
                                        <b>{position.trade_label}</b>
                                        <button
                                            type='button'
                                            aria-label={localize('Dismiss')}
                                            onClick={() => onDismiss(position.contract_id)}
                                        >
                                            &times;
                                        </button>
                                    </header>
                                    <p className='mw-dt__position-state'>
                                        {position.is_sold ? localize('Closed') : localize('Running')}
                                    </p>
                                    <p className='mw-dt__position-profit'>
                                        {profit >= 0 ? '+' : ''}
                                        {money(profit, position.currency)}
                                    </p>
                                    {position.buy_price !== undefined && (
                                        <p className='mw-dt__position-stake'>
                                            {localize('Stake')} {money(position.buy_price, position.currency)}
                                        </p>
                                    )}
                                </article>
                            );
                        })}
                    </div>

                    {positions.length > 0 && (
                        <footer className='mw-dt__positions-foot'>
                            <span>
                                {open_count === 1
                                    ? localize('1 open position')
                                    : localize('{{count}} open positions', { count: open_count })}
                            </span>
                            <span>
                                {localize('Total P/L:')}
                                <b className={total >= 0 ? 'mw-dt__up' : 'mw-dt__down'}>
                                    {` ${total >= 0 ? '+' : ''}${money(total, currency)}`}
                                </b>
                            </span>
                        </footer>
                    )}
                </>
            )}
        </aside>
    );
};

export default PositionsPanel;
