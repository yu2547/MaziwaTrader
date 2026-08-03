import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { observer } from 'mobx-react-lite';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces, standalone_routes } from '@/components/shared';
import { useStore } from '@/hooks/useStore';
import { clearStoredSession } from '@/utils/auth/deriv-oauth';
import { convertFromUsd, useExchangeRates } from '@/utils/currency/exchange-rate';
import {
    StandaloneCashRegisterRegularIcon,
    StandaloneChevronDownRegularIcon,
    StandaloneFileLinesRegularIcon,
    StandalonePhoneRegularIcon,
    StandaloneRightFromBracketRegularIcon,
} from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import SegmentedControl from './segmented-control';
import './oauth-flat-nav.scss';

const CURRENCY_OPTIONS = ['USD', 'KSH'] as const;
type TDisplayCurrency = (typeof CURRENCY_OPTIONS)[number];

// Real MaziwaTrader support line (also used in the deleted region-badge.tsx
// from an earlier design pass) - not a placeholder.
const SUPPORT_PHONE_NUMBER = '0712094877';

// Purely a "live" visual rhythm for the deposit/withdraw shortcut, not tied
// to account state - both labels are always valid actions on the same
// account, so the button just alternates which one it's offering.
const DEPOSIT_WITHDRAW_INTERVAL_MS = 4000;

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
    const [is_showing_withdraw, setIsShowingWithdraw] = useState(false);
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

    useEffect(() => {
        const interval_id = setInterval(() => {
            setIsShowingWithdraw(prev => !prev);
        }, DEPOSIT_WITHDRAW_INTERVAL_MS);
        return () => clearInterval(interval_id);
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

    const handleAccountTypeChange = (value: string) => {
        if (value === oauth_session.account_type) return;
        const target = accounts.find(account => account.account_type === value);
        if (target) oauth_session.selectAccount(target.account_id);
    };

    const handleLogout = () => {
        clearStoredSession();
        oauth_session.clear();
        window.location.href = '/';
    };

    const handleDepositWithdrawClick = () => {
        const redirect_url = new URL(
            is_showing_withdraw ? standalone_routes.cashier_withdrawal : standalone_routes.cashier_deposit
        );
        if (account_currency) redirect_url.searchParams.set('account', account_currency);
        window.open(redirect_url.toString(), '_blank', 'noopener,noreferrer');
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
                <div
                    className='mw-premium-nav__currency-block'
                    role='tablist'
                    aria-label={localize('Display currency')}
                >
                    {CURRENCY_OPTIONS.map(option => {
                        const is_active = option === display_currency;
                        const label = option === 'USD' ? 'USD' : 'KSh';
                        return (
                            <button
                                type='button'
                                key={option}
                                role='tab'
                                aria-selected={is_active}
                                className={`mw-premium-nav__currency-segment ${is_active ? 'mw-premium-nav__currency-segment--active' : ''}`}
                                onClick={() => setDisplayCurrency(option)}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>

                <a
                    className='mw-premium-nav__phone'
                    href={`tel:${SUPPORT_PHONE_NUMBER}`}
                    title={localize('Call support: {{number}}', { number: SUPPORT_PHONE_NUMBER })}
                    aria-label={localize('Call support: {{number}}', { number: SUPPORT_PHONE_NUMBER })}
                >
                    <StandalonePhoneRegularIcon height={16} width={16} />
                </a>

                <button type='button' className='mw-premium-nav__deposit-button' onClick={handleDepositWithdrawClick}>
                    {is_showing_withdraw ? localize('Withdraw') : localize('Deposit')}
                </button>

                <div className='mw-premium-nav__profile' ref={profile_ref}>
                    <button
                        type='button'
                        className='mw-premium-nav__trigger'
                        onClick={() => setIsProfileOpen(prev => !prev)}
                        aria-expanded={is_profile_open}
                        aria-label={localize('Account menu')}
                    >
                        <span className='mw-premium-nav__trigger-icon'>
                            <CurrencyIcon currency={account_currency} isVirtual={is_demo} />
                        </span>
                        <span className='mw-premium-nav__balance'>
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
                        <StandaloneChevronDownRegularIcon
                            height={12}
                            width={12}
                            className={`mw-premium-nav__trigger-chevron ${is_profile_open ? 'mw-premium-nav__trigger-chevron--open' : ''}`}
                        />
                    </button>

                    {is_profile_open && (
                        <div className='mw-premium-nav__panel'>
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
                                            oauth_session.selectAccount(account.account_id);
                                            setIsProfileOpen(false);
                                        }}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                oauth_session.selectAccount(account.account_id);
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
