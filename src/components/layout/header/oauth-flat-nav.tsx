import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { observer } from 'mobx-react-lite';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces, standalone_routes } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { clearStoredSession } from '@/utils/auth/deriv-oauth';
import { convertFromUsd, useExchangeRates } from '@/utils/currency/exchange-rate';
import { LegacyWhatsappIcon } from '@deriv/quill-icons/Legacy';
import {
    StandaloneCashRegisterRegularIcon,
    StandaloneChevronDownBoldIcon,
    StandaloneRightFromBracketRegularIcon,
} from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import { URLConstants } from '@deriv-com/utils';
import SegmentedControl from './segmented-control';
import './oauth-flat-nav.scss';

const CURRENCY_OPTIONS = ['KSH', 'USD'] as const;
type TDisplayCurrency = (typeof CURRENCY_OPTIONS)[number];

/**
 * The account only ever has one real currency (oauth_session.currency) -
 * KSh here is a live-converted reference figure (real rate from
 * open.er-api.com via exchange-rate.ts), never a fabricated one.
 *
 * Real/Demo is not a control on the bar itself: it is the pair of tabs at the
 * top of the account dropdown, where it filters the list below it. Picking a
 * tab only changes what you are looking at; the account changes when a row is
 * clicked, which is also what reconnects the trading socket.
 */
const OAuthFlatNav = observer(() => {
    const { oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const [display_currency, setDisplayCurrency] = useState<TDisplayCurrency>('USD');
    const [is_panel_open, setIsPanelOpen] = useState(false);
    const [panel_type, setPanelType] = useState<'real' | 'demo'>('real');
    const [is_list_open, setIsListOpen] = useState(true);
    const { rates } = useExchangeRates();
    const panel_ref = useRef<HTMLDivElement | null>(null);

    const active_type = oauth_session?.account_type === 'demo' ? 'demo' : 'real';

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (panel_ref.current && !panel_ref.current.contains(event.target as Node)) {
                setIsPanelOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsPanelOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    // Opening the panel should show the account you are actually on, whichever
    // tab was left selected last time.
    useEffect(() => {
        if (is_panel_open) setPanelType(active_type);
    }, [is_panel_open, active_type]);

    if (!oauth_session?.is_authenticated) return null;

    const balance_usd = Number(oauth_session.balance || 0);
    const account_currency = oauth_session.currency || 'USD';
    const decimals = getDecimalPlaces(account_currency);
    const is_demo = active_type === 'demo';
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
    const listed_accounts = accounts.filter(account => account.account_type === panel_type);
    const selected = oauth_session.selected_account;

    // The OTP socket is issued for one account, so picking a different one has
    // to reconnect the trading connection too - otherwise the bar would read
    // Real while the bot still traded Demo (or vice versa).
    const selectAccount = (account_id: string) => {
        oauth_session.selectAccount(account_id);
        api_base.switchOtpAccount(account_id);
        setIsPanelOpen(false);
    };

    const handleLogout = () => {
        clearStoredSession();
        oauth_session.clear();
        window.location.href = '/';
    };

    return (
        <header className='mw-premium-nav'>
            <div className='mw-premium-nav__left'>
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
                <a
                    className='mw-premium-nav__icon-link'
                    href={URLConstants.whatsApp}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-label={localize('WhatsApp support')}
                >
                    <LegacyWhatsappIcon iconSize='xs' />
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
                <a
                    className='mw-premium-nav__deposit'
                    href={standalone_routes.cashier_deposit}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    {localize('Deposit')}
                </a>

                <div className='mw-premium-nav__account' ref={panel_ref}>
                    <button
                        type='button'
                        className='mw-premium-nav__balance'
                        onClick={() => setIsPanelOpen(prev => !prev)}
                        aria-expanded={is_panel_open}
                        aria-label={localize('Account menu')}
                    >
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
                        <span
                            className={`mw-premium-nav__balance-caret ${is_panel_open ? 'mw-premium-nav__balance-caret--open' : ''}`}
                        >
                            <StandaloneChevronDownBoldIcon iconSize='xs' />
                        </span>
                    </button>

                    {is_panel_open && (
                        <div className='mw-premium-nav__panel'>
                            <div className='mw-premium-nav__panel-tabs' role='tablist'>
                                {(['real', 'demo'] as const).map(type => (
                                    <button
                                        key={type}
                                        type='button'
                                        role='tab'
                                        aria-selected={panel_type === type}
                                        className={`mw-premium-nav__panel-tab ${panel_type === type ? 'mw-premium-nav__panel-tab--active' : ''}`}
                                        onClick={() => setPanelType(type)}
                                    >
                                        {type === 'real' ? localize('Real') : localize('Demo')}
                                    </button>
                                ))}
                            </div>

                            <button
                                type='button'
                                className='mw-premium-nav__panel-section'
                                onClick={() => setIsListOpen(prev => !prev)}
                                aria-expanded={is_list_open}
                            >
                                {localize('Deriv accounts')}
                                <span
                                    className={`mw-premium-nav__panel-section-caret ${is_list_open ? 'mw-premium-nav__panel-section-caret--open' : ''}`}
                                >
                                    <StandaloneChevronDownBoldIcon iconSize='xs' />
                                </span>
                            </button>

                            {is_list_open && (
                                <div className='mw-premium-nav__panel-list'>
                                    {listed_accounts.length === 0 && (
                                        <p className='mw-premium-nav__panel-empty'>
                                            {panel_type === 'demo'
                                                ? localize('This login has no demo account.')
                                                : localize('This login has no real account.')}
                                        </p>
                                    )}
                                    {listed_accounts.map(account => (
                                        <button
                                            key={account.account_id}
                                            type='button'
                                            className={`mw-premium-nav__panel-account ${account.account_id === selected?.account_id ? 'mw-premium-nav__panel-account--active' : ''}`}
                                            onClick={() => selectAccount(account.account_id)}
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
                                            <span className='mw-premium-nav__panel-account-balance'>
                                                {addComma(
                                                    Number(account.balance || 0).toFixed(
                                                        getDecimalPlaces(account.currency)
                                                    )
                                                )}{' '}
                                                {account.currency}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className='mw-premium-nav__panel-divider' />
                            <button type='button' className='mw-premium-nav__panel-logout' onClick={handleLogout}>
                                {localize('Logout')}
                                <StandaloneRightFromBracketRegularIcon height={14} width={14} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
});

export default OAuthFlatNav;
