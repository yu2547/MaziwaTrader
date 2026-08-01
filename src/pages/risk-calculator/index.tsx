import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { addComma, getDecimalPlaces } from '@/components/shared';
import { useStore } from '@/hooks/useStore';
import { useTranslations } from '@deriv-com/translations';
import './risk-calculator.scss';

/**
 * Fully client-side - every value here is derived from the four inputs
 * below plus the account balance, so it works identically regardless of
 * session type (classic or OAuth) and needs no live connection at all.
 */
const DEFAULT_PAYOUT_PCT = 85;
const DEFAULT_RISK_PCT = 2;
const DEFAULT_DAILY_LOSS_LIMIT_PCT = 6;
const DEFAULT_TARGET_PROFIT_PCT = 10;

const formatCurrency = (value: number, decimals: number) => addComma(value.toFixed(decimals));

const NumberField = ({
    label,
    value,
    onChange,
    suffix,
    min = 0,
    max,
    step = 0.1,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    suffix?: string;
    min?: number;
    max?: number;
    step?: number;
}) => (
    <label className='mw-risk-calc__field'>
        <span className='mw-risk-calc__field-label'>{label}</span>
        <div className='mw-risk-calc__field-input'>
            <input
                type='number'
                value={Number.isFinite(value) ? value : ''}
                onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
                min={min}
                max={max}
                step={step}
            />
            {suffix && <span className='mw-risk-calc__field-suffix'>{suffix}</span>}
        </div>
    </label>
);

const ResultCard = ({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: string }) => (
    <div className={`mw-risk-calc__result mw-risk-calc__result--${tone}`}>
        <span className='mw-risk-calc__result-label'>{label}</span>
        <span className='mw-risk-calc__result-value'>{value}</span>
    </div>
);

const RiskCalculatorPage = observer(() => {
    const { client, oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();

    const is_oauth_session = !!oauth_session?.is_authenticated;
    const account_balance = is_oauth_session ? (oauth_session?.balance ?? 0) : Number(client?.balance || 0);
    const account_currency = (is_oauth_session ? oauth_session?.currency : client?.currency) || 'USD';
    const decimals = getDecimalPlaces(account_currency);

    const [balance, setBalance] = useState<number>(account_balance || 1000);
    const [risk_pct, setRiskPct] = useState(DEFAULT_RISK_PCT);
    const [payout_pct, setPayoutPct] = useState(DEFAULT_PAYOUT_PCT);
    const [daily_loss_limit_pct, setDailyLossLimitPct] = useState(DEFAULT_DAILY_LOSS_LIMIT_PCT);
    const [target_profit_pct, setTargetProfitPct] = useState(DEFAULT_TARGET_PROFIT_PCT);

    // Balance only follows the account once, on first real value - after
    // that the field is the user's own to experiment with (e.g. planning
    // against a hypothetical balance), not silently overwritten on every render.
    const [has_synced_balance, setHasSyncedBalance] = useState(false);
    useEffect(() => {
        if (!has_synced_balance && account_balance > 0) {
            setBalance(account_balance);
            setHasSyncedBalance(true);
        }
    }, [has_synced_balance, account_balance]);

    const results = useMemo(() => {
        const max_risk_per_trade = balance * (risk_pct / 100);
        const recommended_stake = max_risk_per_trade;
        const expected_profit = recommended_stake * (payout_pct / 100);
        const expected_loss = recommended_stake;
        const risk_to_reward =
            expected_profit > 0 ? `1 : ${(expected_profit / recommended_stake || 0).toFixed(2)}` : '—';
        const daily_loss_limit = balance * (daily_loss_limit_pct / 100);
        const target_profit = balance * (target_profit_pct / 100);
        const max_trades_before_limit = max_risk_per_trade > 0 ? Math.floor(daily_loss_limit / max_risk_per_trade) : 0;

        return {
            max_risk_per_trade,
            recommended_stake,
            expected_profit,
            expected_loss,
            risk_to_reward,
            daily_loss_limit,
            target_profit,
            max_trades_before_limit,
        };
    }, [balance, risk_pct, payout_pct, daily_loss_limit_pct, target_profit_pct]);

    return (
        <div className='mw-risk-calc'>
            <div className='mw-risk-calc__header'>
                <h1>{localize('Risk Calculator')}</h1>
                <p>
                    {localize(
                        'Plan your position size and daily limits before you trade. Every figure below updates live as you adjust the inputs - nothing here is sent anywhere, it only runs in your browser.'
                    )}
                </p>
            </div>

            <div className='mw-risk-calc__layout'>
                <div className='mw-risk-calc__panel'>
                    <h2>{localize('Your inputs')}</h2>
                    <NumberField
                        label={localize('Account balance')}
                        value={balance}
                        onChange={setBalance}
                        suffix={account_currency}
                        step={1}
                    />
                    <NumberField
                        label={localize('Risk per trade')}
                        value={risk_pct}
                        onChange={setRiskPct}
                        suffix='%'
                        max={100}
                    />
                    <NumberField
                        label={localize('Expected payout')}
                        value={payout_pct}
                        onChange={setPayoutPct}
                        suffix='%'
                        max={1000}
                        step={1}
                    />
                    <NumberField
                        label={localize('Daily loss limit')}
                        value={daily_loss_limit_pct}
                        onChange={setDailyLossLimitPct}
                        suffix='%'
                        max={100}
                    />
                    <NumberField
                        label={localize('Target profit')}
                        value={target_profit_pct}
                        onChange={setTargetProfitPct}
                        suffix='%'
                        max={1000}
                    />
                </div>

                <div className='mw-risk-calc__panel'>
                    <h2>{localize('Results')}</h2>
                    <div className='mw-risk-calc__results-grid'>
                        <ResultCard
                            label={localize('Position size')}
                            value={`${formatCurrency(results.recommended_stake, decimals)} ${account_currency}`}
                        />
                        <ResultCard
                            label={localize('Recommended stake size')}
                            value={`${formatCurrency(results.recommended_stake, decimals)} ${account_currency}`}
                        />
                        <ResultCard
                            label={localize('Maximum risk per trade')}
                            value={`${formatCurrency(results.max_risk_per_trade, decimals)} ${account_currency}`}
                            tone='warn'
                        />
                        <ResultCard label={localize('Risk percentage')} value={`${risk_pct}%`} />
                        <ResultCard
                            label={localize('Expected profit')}
                            value={`+${formatCurrency(results.expected_profit, decimals)} ${account_currency}`}
                            tone='good'
                        />
                        <ResultCard
                            label={localize('Expected loss')}
                            value={`-${formatCurrency(results.expected_loss, decimals)} ${account_currency}`}
                            tone='bad'
                        />
                        <ResultCard label={localize('Risk-to-reward ratio')} value={results.risk_to_reward} />
                        <ResultCard
                            label={localize('Daily loss limit')}
                            value={`${formatCurrency(results.daily_loss_limit, decimals)} ${account_currency}`}
                            tone='bad'
                        />
                        <ResultCard
                            label={localize('Target profit')}
                            value={`${formatCurrency(results.target_profit, decimals)} ${account_currency}`}
                            tone='good'
                        />
                        <ResultCard
                            label={localize('Trades before daily limit')}
                            value={String(results.max_trades_before_limit)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
});

export default RiskCalculatorPage;
