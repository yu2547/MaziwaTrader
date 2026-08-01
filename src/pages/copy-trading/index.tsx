import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from '@deriv-com/translations';
import './copy-trading.scss';

type TAccountType = 'real' | 'demo';

interface TFollowerAccount {
    id: string;
    label: string;
    token: string;
    account_type: TAccountType;
    added_at: number;
}

interface TStrategyPreset {
    id: string;
    name: string;
    description: string;
    copy_ratio: number;
    max_position_pct: number;
    max_daily_loss_pct: number;
}

const STRATEGY_PRESETS: TStrategyPreset[] = [
    {
        id: 'conservative',
        name: 'Conservative',
        description: 'Smaller copied stakes and a tighter daily loss cap, for cautiously mirroring a strategy.',
        copy_ratio: 0.5,
        max_position_pct: 2,
        max_daily_loss_pct: 3,
    },
    {
        id: 'balanced',
        name: 'Balanced',
        description: 'Stakes copied 1:1 with a moderate daily loss cap.',
        copy_ratio: 1,
        max_position_pct: 5,
        max_daily_loss_pct: 6,
    },
    {
        id: 'aggressive',
        name: 'Aggressive',
        description: 'Amplified copied stakes for followers comfortable with larger swings.',
        copy_ratio: 2,
        max_position_pct: 10,
        max_daily_loss_pct: 12,
    },
];

// Never persisted to localStorage - these are live trading API tokens, kept
// in memory only for this page's session so a refresh clears them rather
// than leaving credentials sitting in browser storage indefinitely.
const maskToken = (token: string) => {
    if (token.length <= 4) return '••••';
    return `••••${token.slice(-4)}`;
};

const NumberField = ({
    label,
    value,
    onChange,
    suffix,
    min = 0,
    max,
    step = 1,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    suffix?: string;
    min?: number;
    max?: number;
    step?: number;
}) => (
    <label className='mw-copy-trading__field'>
        <span className='mw-copy-trading__field-label'>{label}</span>
        <div className='mw-copy-trading__field-input'>
            <input
                type='number'
                value={Number.isFinite(value) ? value : ''}
                onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
                min={min}
                max={max}
                step={step}
            />
            {suffix && <span className='mw-copy-trading__field-suffix'>{suffix}</span>}
        </div>
    </label>
);

const CopyTradingPage = observer(() => {
    const { localize } = useTranslations();

    const [accounts, setAccounts] = useState<TFollowerAccount[]>([]);
    const [token_input, setTokenInput] = useState('');
    const [account_type, setAccountType] = useState<TAccountType>('demo');
    const [search_term, setSearchTerm] = useState('');

    const [selected_preset, setSelectedPreset] = useState<string>('balanced');
    const [copy_ratio, setCopyRatio] = useState(1);
    const [max_position_pct, setMaxPositionPct] = useState(5);
    const [max_daily_loss_pct, setMaxDailyLossPct] = useState(6);
    const [max_concurrent_copies, setMaxConcurrentCopies] = useState(3);
    const [max_drawdown_pct, setMaxDrawdownPct] = useState(15);
    const [mirror_mode, setMirrorMode] = useState<'all' | 'wins_only'>('all');

    const applyPreset = (preset: TStrategyPreset) => {
        setSelectedPreset(preset.id);
        setCopyRatio(preset.copy_ratio);
        setMaxPositionPct(preset.max_position_pct);
        setMaxDailyLossPct(preset.max_daily_loss_pct);
    };

    const addAccount = () => {
        const trimmed = token_input.trim();
        if (!trimmed) return;
        const new_account: TFollowerAccount = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            label: `${account_type === 'real' ? localize('Real') : localize('Demo')} · ${maskToken(trimmed)}`,
            token: trimmed,
            account_type,
            added_at: Date.now(),
        };
        setAccounts(prev => [new_account, ...prev]);
        setTokenInput('');
    };

    const removeAccount = (id: string) => {
        setAccounts(prev => prev.filter(account => account.id !== id));
    };

    const filtered_accounts = useMemo(() => {
        const normalized = search_term.trim().toLowerCase();
        if (!normalized) return accounts;
        return accounts.filter(
            account => account.label.toLowerCase().includes(normalized) || account.account_type.includes(normalized)
        );
    }, [accounts, search_term]);

    const real_count = accounts.filter(account => account.account_type === 'real').length;
    const demo_count = accounts.length - real_count;

    return (
        <div className='mw-copy-trading'>
            <div className='mw-copy-trading__header'>
                <h1>{localize('Copy Trading')}</h1>
                <p>
                    {localize(
                        "Configure how you'll copy trades and manage follower accounts now, so everything is ready the moment execution goes live. Nothing on this page simulates trades, balances, or performance - actions that require the trading engine are clearly disabled below."
                    )}
                </p>
            </div>

            <div className='mw-copy-trading__summary'>
                <div className='mw-copy-trading__summary-card'>
                    <span className='mw-copy-trading__summary-label'>{localize('Accounts added')}</span>
                    <span className='mw-copy-trading__summary-value'>{accounts.length}</span>
                </div>
                <div className='mw-copy-trading__summary-card'>
                    <span className='mw-copy-trading__summary-label'>{localize('Real / Demo')}</span>
                    <span className='mw-copy-trading__summary-value'>
                        {real_count} / {demo_count}
                    </span>
                </div>
                <div className='mw-copy-trading__summary-card'>
                    <span className='mw-copy-trading__summary-label'>{localize('Active copy sessions')}</span>
                    <span className='mw-copy-trading__summary-value'>0</span>
                </div>
                <div className='mw-copy-trading__summary-card'>
                    <span className='mw-copy-trading__summary-label'>{localize('Trades copied')}</span>
                    <span className='mw-copy-trading__summary-value'>0</span>
                </div>
            </div>

            <section className='mw-copy-trading__section'>
                <h2>{localize('Strategy presets')}</h2>
                <p className='mw-copy-trading__section-hint'>
                    {localize(
                        'Configuration presets, not performance claims - pick one as a starting point and fine-tune below.'
                    )}
                </p>
                <div className='mw-copy-trading__presets'>
                    {STRATEGY_PRESETS.map(preset => (
                        <button
                            type='button'
                            key={preset.id}
                            className={`mw-copy-trading__preset-card ${selected_preset === preset.id ? 'mw-copy-trading__preset-card--active' : ''}`}
                            onClick={() => applyPreset(preset)}
                        >
                            <span className='mw-copy-trading__preset-name'>{localize(preset.name)}</span>
                            <span className='mw-copy-trading__preset-desc'>{localize(preset.description)}</span>
                            <span className='mw-copy-trading__preset-meta'>
                                {preset.copy_ratio}x · {localize('max')} {preset.max_position_pct}%
                            </span>
                        </button>
                    ))}
                </div>
            </section>

            <div className='mw-copy-trading__grid'>
                <section className='mw-copy-trading__section'>
                    <h2>{localize('Copy settings')}</h2>
                    <div className='mw-copy-trading__field-grid'>
                        <NumberField
                            label={localize('Copy ratio')}
                            value={copy_ratio}
                            onChange={value => {
                                setCopyRatio(value);
                                setSelectedPreset('');
                            }}
                            suffix='x'
                            min={0.1}
                            max={10}
                            step={0.1}
                        />
                        <NumberField
                            label={localize('Max position size')}
                            value={max_position_pct}
                            onChange={value => {
                                setMaxPositionPct(value);
                                setSelectedPreset('');
                            }}
                            suffix='%'
                            max={100}
                        />
                        <label className='mw-copy-trading__field'>
                            <span className='mw-copy-trading__field-label'>{localize('Mirror mode')}</span>
                            <select
                                className='mw-copy-trading__mirror-select'
                                value={mirror_mode}
                                onChange={event => setMirrorMode(event.target.value as 'all' | 'wins_only')}
                            >
                                <option value='all'>{localize('Copy all trades')}</option>
                                <option value='wins_only'>{localize('Copy winning setups only')}</option>
                            </select>
                        </label>
                    </div>
                </section>

                <section className='mw-copy-trading__section'>
                    <h2>{localize('Risk controls')}</h2>
                    <div className='mw-copy-trading__field-grid'>
                        <NumberField
                            label={localize('Max daily loss')}
                            value={max_daily_loss_pct}
                            onChange={value => {
                                setMaxDailyLossPct(value);
                                setSelectedPreset('');
                            }}
                            suffix='%'
                            max={100}
                        />
                        <NumberField
                            label={localize('Max concurrent copies')}
                            value={max_concurrent_copies}
                            onChange={setMaxConcurrentCopies}
                            min={1}
                            max={50}
                        />
                        <NumberField
                            label={localize('Max drawdown stop')}
                            value={max_drawdown_pct}
                            onChange={setMaxDrawdownPct}
                            suffix='%'
                            max={100}
                        />
                    </div>
                </section>
            </div>

            <section className='mw-copy-trading__section'>
                <h2>{localize('Follower accounts')}</h2>
                <p className='mw-copy-trading__section-hint'>
                    {localize(
                        "Tokens are kept only in this browser tab for this session - they're never sent anywhere until copy trading execution is available, and are cleared on refresh."
                    )}
                </p>
                <div className='mw-copy-trading__token-row'>
                    <input
                        type='password'
                        className='mw-copy-trading__token-input'
                        placeholder={localize("Enter follower's Deriv API token (trade scope)")}
                        value={token_input}
                        onChange={event => setTokenInput(event.target.value)}
                        aria-label={localize('Follower API token')}
                    />
                    <select
                        className='mw-copy-trading__account-type-select'
                        value={account_type}
                        onChange={event => setAccountType(event.target.value as TAccountType)}
                    >
                        <option value='demo'>{localize('Demo')}</option>
                        <option value='real'>{localize('Real')}</option>
                    </select>
                    <button
                        type='button'
                        className='mw-copy-trading__add-btn'
                        onClick={addAccount}
                        disabled={!token_input.trim()}
                    >
                        {localize('Add')}
                    </button>
                    <button
                        type='button'
                        className='mw-copy-trading__sync-btn'
                        disabled
                        title={localize('Sync unavailable until the trading engine is connected')}
                    >
                        {localize('Sync')}
                    </button>
                </div>

                {accounts.length > 0 && (
                    <input
                        type='text'
                        className='mw-copy-trading__search-input'
                        placeholder={localize('Search added accounts…')}
                        value={search_term}
                        onChange={event => setSearchTerm(event.target.value)}
                        aria-label={localize('Search accounts')}
                    />
                )}

                {accounts.length === 0 ? (
                    <p className='mw-copy-trading__empty'>{localize('No accounts added yet.')}</p>
                ) : (
                    <ul className='mw-copy-trading__account-list'>
                        {filtered_accounts.map(account => (
                            <li key={account.id} className='mw-copy-trading__account-row'>
                                <span
                                    className={`mw-copy-trading__account-badge mw-copy-trading__account-badge--${account.account_type}`}
                                >
                                    {account.account_type === 'real' ? localize('Real') : localize('Demo')}
                                </span>
                                <span className='mw-copy-trading__account-label'>{maskToken(account.token)}</span>
                                <span className='mw-copy-trading__account-status'>
                                    {localize('Pending — will connect once execution is available')}
                                </span>
                                <button
                                    type='button'
                                    className='mw-copy-trading__remove-btn'
                                    onClick={() => removeAccount(account.id)}
                                    aria-label={localize('Remove account')}
                                >
                                    ✕
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <p className='mw-copy-trading__total'>
                    {localize('Total accounts added')}: {accounts.length}
                </p>
            </section>

            <section className='mw-copy-trading__section'>
                <h2>{localize('Performance')}</h2>
                <div className='mw-copy-trading__table-wrapper'>
                    <table className='mw-copy-trading__table'>
                        <thead>
                            <tr>
                                <th>{localize('Date')}</th>
                                <th>{localize('Symbol')}</th>
                                <th>{localize('Type')}</th>
                                <th>{localize('Stake')}</th>
                                <th>{localize('P/L')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td colSpan={5} className='mw-copy-trading__table-empty'>
                                    {localize(
                                        'No trades yet — this table will populate once copy trading execution is available.'
                                    )}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className='mw-copy-trading__equity'>
                    <span className='mw-copy-trading__equity-label'>{localize('Equity curve')}</span>
                    <div className='mw-copy-trading__equity-placeholder'>
                        <svg viewBox='0 0 200 40' className='mw-copy-trading__equity-line'>
                            <line x1='0' y1='20' x2='200' y2='20' strokeDasharray='4 6' />
                        </svg>
                        <span>{localize('Equity curve will appear once copy trading is active.')}</span>
                    </div>
                </div>
            </section>

            <div className='mw-copy-trading__execution-notice'>
                <p>
                    {localize(
                        'Execution requires the classic Deriv trading connection, which is currently unavailable. Your settings and accounts above are saved on this page and ready to activate once that connection is restored.'
                    )}
                </p>
                <button
                    type='button'
                    className='mw-copy-trading__start-btn'
                    disabled
                    title={localize('Execution unavailable')}
                >
                    {localize('Start Copy Trading')}
                </button>
            </div>
        </div>
    );
});

export default CopyTradingPage;
