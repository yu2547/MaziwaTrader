import { useState } from 'react';
import { motion } from 'framer-motion';
import { observer } from 'mobx-react-lite';
import { addComma } from '@/components/shared';
import { useStore } from '@/hooks/useStore';
import { convertFromUsd, useExchangeRates } from '@/utils/currency/exchange-rate';
import { useTranslations } from '@deriv-com/translations';
import SegmentedControl from './segmented-control';
import './currency-selector.scss';

const OPTIONS = [
    { value: 'USD', label: 'USD' },
    { value: 'KSH', label: 'KSh' },
];

/**
 * The account only ever has one real currency (oauth_session.currency, e.g.
 * USD) - there's no such thing as a real KES-denominated balance for this
 * account. Selecting KSh here shows a live-converted reference figure (real
 * rate from open.er-api.com, not invented), it never claims the account
 * itself changed currency.
 */
const CurrencySelector = observer(() => {
    const { oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const [display_currency, setDisplayCurrency] = useState<'USD' | 'KSH'>('USD');
    const { rates, is_loading, error } = useExchangeRates();

    if (!oauth_session?.is_authenticated) return null;

    const balance_usd = Number(oauth_session.balance || 0);
    const account_currency = oauth_session.currency || 'USD';
    const needs_conversion = display_currency === 'KSH' && account_currency === 'USD';
    const converted = needs_conversion ? convertFromUsd(balance_usd, rates, 'KES') : null;

    let display_value: string;
    let is_stale = false;
    if (!needs_conversion) {
        display_value = `${addComma(balance_usd.toFixed(2))} ${account_currency}`;
    } else if (converted != null) {
        display_value = `${addComma(converted.toFixed(2))} KSh`;
    } else if (is_loading) {
        display_value = localize('Fetching live rate…');
    } else {
        // Rate fetch failed and there's nothing cached yet - degrade to the
        // real USD figure with a clear label rather than showing a dead
        // "unavailable" state or, worse, a stale/invented number.
        display_value = `${addComma(balance_usd.toFixed(2))} USD`;
        is_stale = !!error;
    }

    return (
        <div className='mw-currency-selector'>
            <SegmentedControl
                id='currency'
                ariaLabel={localize('Display currency')}
                options={OPTIONS}
                value={display_currency}
                onChange={value => setDisplayCurrency(value as 'USD' | 'KSH')}
            />
            <span
                className={`mw-currency-selector__balance ${is_stale ? 'mw-currency-selector__balance--stale' : ''}`}
                title={is_stale ? localize('Live KSh rate unavailable right now - showing USD') : undefined}
                aria-live='polite'
            >
                <motion.span
                    key={display_value}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                >
                    {display_value}
                </motion.span>
            </span>
        </div>
    );
});

export default CurrencySelector;
