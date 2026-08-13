import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { observer } from 'mobx-react-lite';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces, standalone_routes } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { clearStoredSession } from '@/utils/auth/deriv-oauth';
import { convertFromUsd, useExchangeRates } from '@/utils/currency/exchange-rate';
import {
    StandaloneCashRegisterRegularIcon,
    StandaloneCircleUserRegularIcon,
    StandaloneFileLinesRegularIcon,
    StandaloneRightFromBracketRegularIcon,
} from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import SegmentedControl from './segmented-control';
import './oauth-flat-nav.scss';

const CURRENCY_OPTIONS = ['USD', 'KSH'] as const;
type TDisplayCurrency = (typeof CURRENCY_OPTIONS)[number];

/**
 * The account only ever has one real currency (oauth_session.currency) -
 * KSh here is a live-converted reference figure (real rate from
 * open.er-api.com via exchange-rate.ts), never a fabricated one.
 */
const OAuthFlatNav = observer(() => {
    const { oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const [display_currency, setDisplayCurrency] = useState<TDisplayCurrency>('USD');
    const [is_profile_open, setIsProfileOpen] = useState(false);
    const { rates } = useExchangeRates();
    const profile_ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (profile_ref.current && !profile_ref.current.contains(event.target as Node)) {
                setIsProfileOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsProfileOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    if (!oauth_session?.is_authenticated) return null;

    const balance_usd = Number(oauth_session.balance || 0);
    const account_currency = oauth_session.currency || 'USD';
    const decimals = getDecimalPlaces(account_currency);
    const is_demo = oauth_session.account_type === 'demo';
    const converted =
        display_currency === 'KSH' && account_currency === 'USD' ? convertFromUsd(balance_usd, rates, 'KES') : null;

    let balance_number: string;
    let balance_currency: string;
    if (display_currency === 'USD' || account_currency !== 'USD') {
        balance_number = addComma(balance_usd.toFixed(decimals));
        balance_currency = account_currency;
    } else if (converted != null) {
        balance_number = addComma(Math.round(converted).toLocaleString());
        balance_currency = 'KSh';
    } else {
        balance_number = addComma(balance_usd.toFixed(decimals));
        balance_currency = 'USD';
    }

    const accounts = oauth_session.accounts ?? [];
    const active_type = is_demo ? 'demo' : 'real';
    const accounts_of_active_type = accounts.filter(account => account.account_type === active_type);
    const selected = oauth_session.selected_account;

    // The OTP socket is issued for one account, so picking a different one has
    // to reconnect the trading connection too - otherwise the header would
    // show Real while the bot still traded Demo (or vice versa).
    const selectAccount = (account_id: string) => {
        oauth_session.selectAccount(account_id);
        api_base.switchOtpAccount(account_id);
    };

    const handleAccountTypeChange = (value: string) => {
        if (value === oauth_session.account_type) return;
        const target = accounts.find(account => account.account_type === value);
        if (target) selectAccount(target.account_id);
    };

    const handleLogout = () => {
        clearStoredSession();
        oauth_session.clear();
        window.location.href = '/';
    };

    return (
        <header className='mw-premium-nav'>
            <div className='mw-premium-nav__left'>
                <a
                    className='mw-premium-nav__link'
                    href={standalone_routes.reports}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    <StandaloneFileLinesRegularIcon height={16} width={16} />
                    {localize('Reports')}
                </a>
                <a
                    className='mw-premium-nav__link'
                    href={standalone_routes.cashier}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    <StandaloneCashRegisterRegularIcon height={16} width={16} />
                    {localize('Cashier')}
                </a>
            </div>

            <div className='mw-premium-nav__right'>
                <SegmentedControl
                    id='account-type'
                    ariaLabel={localize('Account type')}
                    options={[
                        { value: 'real', label: localize('Real') },
                        { value: 'demo', label: localize('Demo') },
                    ]}
                    value={active_type}
                    onChange={handleAccountTypeChange}
                />
                <SegmentedControl
                    id='currency'
                    ariaLabel={localize('Display currency')}
                    options={CURRENCY_OPTIONS.map(option => ({
                        value: option,
                        label: option === 'USD' ? 'USD' : 'KSh',
                    }))}
                    value={display_currency}
                    onChange={value => setDisplayCurrency(value as TDisplayCurrency)}
                />

                <span className='mw-premium-nav__balance'>
                    <span className='mw-premium-nav__balance-icon'>
                        <CurrencyIcon currency={account_currency} isVirtual={is_demo} />
                    </span>
                    <motion.span
                        key={`${balance_number}-${balance_currency}`}
                        className='mw-premium-nav__balance-number'
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                    >
                        {balance_number}
                    </motion.span>
                    <span className='mw-premium-nav__balance-currency'>{balance_currency}</span>
                </span>

                <div className='mw-premium-nav__profile' ref={profile_ref}>
                    <button
                        type='button'
                        className='mw-premium-nav__avatar'
                        onClick={() => setIsProfileOpen(prev => !prev)}
                        aria-expanded={is_profile_open}
                        aria-label={localize('Account menu')}
                    >
                        <StandaloneCircleUserRegularIcon height={18} width={18} />
                    </button>

                    {is_profile_open && (
                        <div className='mw-premium-nav__panel'>
                            <div className='mw-premium-nav__panel-header'>
                                {accounts_of_active_type.length === 1
                                    ? localize('Deriv account')
                                    : localize('Deriv accounts')}
                            </div>
                            <div className='mw-premium-nav__panel-list'>
                                {accounts_of_active_type.map(account => (
                                    <div
                                        key={account.account_id}
                                        className={`mw-premium-nav__panel-account ${account.account_id === selected?.account_id ? 'mw-premium-nav__panel-account--active' : ''}`}
                                        role='button'
                                        tabIndex={0}
                                        onClick={() => {
                                            selectAccount(account.account_id);
                                            setIsProfileOpen(false);
                                        }}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                selectAccount(account.account_id);
                                                setIsProfileOpen(false);
                                            }
                                        }}
                                    >
                                        <CurrencyIcon
                                            currency={account.currency}
                                            isVirtual={account.account_type === 'demo'}
                                        />
                                        <span className='mw-premium-nav__panel-account-info'>
                                            <span>{account.currency}</span>
                                            <span className='mw-premium-nav__panel-account-id'>
                                                {account.account_id}
                                            </span>
                                        </span>
                                        {account.account_type === 'demo' ? (
                                            <button
                                                type='button'
                                                className='mw-premium-nav__panel-reset'
                                                disabled
                                                title={localize(
                                                    'Not available yet - no reset endpoint is wired up for this account type'
                                                )}
                                            >
                                                {localize('Reset balance')}
                                            </button>
                                        ) : (
                                            <span className='mw-premium-nav__panel-account-balance'>
                                                {addComma(
                                                    Number(account.balance || 0).toFixed(
                                                        getDecimalPlaces(account.currency)
                                                    )
                                                )}{' '}
                                                {account.currency}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className='mw-premium-nav__panel-divider' />
                            <button type='button' className='mw-premium-nav__panel-logout' onClick={handleLogout}>
                                <StandaloneRightFromBracketRegularIcon height={14} width={14} />
                                {localize('Logout')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
});

export default OAuthFlatNav;
