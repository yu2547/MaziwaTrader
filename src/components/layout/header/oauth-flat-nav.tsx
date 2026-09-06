import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { observer } from 'mobx-react-lite';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces, standalone_routes } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import useLiveBalance from '@/hooks/useLiveBalance';
import { useStore } from '@/hooks/useStore';
import { clearStoredSession } from '@/utils/auth/deriv-oauth';
import { convertFromUsd, useExchangeRates } from '@/utils/currency/exchange-rate';
import {
    StandaloneBarsRegularIcon,
    StandaloneCashRegisterRegularIcon,
    StandaloneChevronDownBoldIcon,
    StandaloneRightFromBracketRegularIcon,
} from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import MobileDrawer from '../mobile-drawer';
import SegmentedControl from './segmented-control';
import './oauth-flat-nav.scss';

const CURRENCY_OPTIONS = ['KSH', 'USD'] as const;
type TDisplayCurrency = (typeof CURRENCY_OPTIONS)[number];

/** Idle -> working -> done|error -> idle. Drives the button's label and colour. */
type TResetState = 'idle' | 'working' | 'done' | 'error';

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
    const { connectionStatus } = useApiBase();
    // Routes the account's live `balance` stream into the store this header
    // reads. Mounted here because this bar is the only thing that renders for
    // an OAuth session, so it mounts exactly once.
    useLiveBalance();
    const [display_currency, setDisplayCurrency] = useState<TDisplayCurrency>('USD');
    const [is_panel_open, setIsPanelOpen] = useState(false);
    // Phone-width menu. The bar itself is unchanged on desktop, where the
    // hamburger is not rendered at all.
    const [is_drawer_open, setIsDrawerOpen] = useState(false);
    const [panel_type, setPanelType] = useState<'real' | 'demo'>('real');
    const [is_list_open, setIsListOpen] = useState(true);
    const { rates } = useExchangeRates();
    const panel_ref = useRef<HTMLDivElement | null>(null);
    const [reset_state, setResetState] = useState<TResetState>('idle');
    const [reset_error, setResetError] = useState<string | null>(null);
    const reset_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    useEffect(() => () => clearTimeout(reset_timer.current ?? undefined), []);

    if (!oauth_session?.is_authenticated) return null;

    // null means Deriv has not given us a balance for this account yet -
    // distinct from a real zero, and never rendered as one.
    const live_balance = oauth_session.balance;
    const account_currency = oauth_session.currency || 'USD';
    const decimals = getDecimalPlaces(account_currency);
    const is_demo = active_type === 'demo';
    const is_disconnected = connectionStatus === CONNECTION_STATUS.CLOSED;
    const has_balance = live_balance !== null;
    const balance_usd = live_balance ?? 0;
    const converted =
        display_currency === 'KSH' && account_currency === 'USD' && has_balance
            ? convertFromUsd(balance_usd, rates, 'KES')
            : null;

    let balance_number: string;
    let balance_currency: string;
    if (!has_balance) {
        // A dash, not a zero. The connection state below says why.
        balance_number = '—';
        balance_currency = is_disconnected ? localize('Reconnecting…') : localize('Loading…');
    } else if (display_currency === 'USD' || account_currency !== 'USD') {
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

    /**
     * Deriv's own demo top-up, over the socket that is already authorised for
     * this account - no second connection, and nothing invented locally.
     *
     * topup_virtual applies to whichever account the socket is authorised for,
     * which is the selected one. That is why the button is only ever offered on
     * the selected demo row: offered anywhere else it would silently top up a
     * different account from the one it sits next to.
     */
    const resetDemoBalance = async () => {
        // One request at a time, and never on a real account.
        if (reset_state === 'working' || !is_demo) return;

        clearTimeout(reset_timer.current ?? undefined);
        setResetError(null);
        setResetState('working');

        const returnToIdle = (delay: number) => {
            reset_timer.current = setTimeout(() => {
                setResetState('idle');
                setResetError(null);
            }, delay);
        };

        try {
            const response = await api_base.api?.send({ topup_virtual: 1 });
            if (response?.error) throw response.error;

            // The reply carries `amount` - how much was credited - not the new
            // balance, so the balance is read rather than inferred from it.
            // A read moves nothing, and it lands on the same socket the header
            // already listens to (see useLiveBalance).
            const balance_response = await api_base.api?.send({ balance: 1 });
            const next = balance_response?.balance;
            if (next && typeof next === 'object') {
                oauth_session.setLiveBalance(next.balance, next.currency);
            }

            setResetState('done');
            returnToIdle(2500);
        } catch (error) {
            // Deriv's own words, on screen. "Reset failed" alone cannot
            // distinguish the two things that actually go wrong here - a
            // top-up Deriv refuses (the balance is too high to qualify) from a
            // request this socket does not implement - and those need opposite
            // responses from whoever is reading it.
            // A rejected send() hands back the whole response envelope, so the
            // useful fields are one level down in `.error` - reading code and
            // message off the top of it is what produced "unknown [object
            // Object]". A thrown response.error is already unwrapped, hence
            // both shapes. Anything else is stringified rather than left to
            // print as [object Object] again.
            const raw = (error ?? {}) as {
                code?: string;
                message?: string;
                error?: { code?: string; message?: string };
            };
            const detail = raw.error ?? raw;
            const code = detail.code ?? 'unknown';
            let message = detail.message ?? '';
            if (!message) {
                try {
                    message = JSON.stringify(error);
                } catch {
                    message = String(error);
                }
            }
            // eslint-disable-next-line no-console
            console.warn('Demo balance reset failed:', code, message, error);
            setResetError(`${message} (${code})`);
            setResetState('error');
            returnToIdle(8000);
        }
    };

    const reset_label = {
        idle: localize('Reset balance'),
        working: localize('Resetting…'),
        done: localize('Balance updated'),
        error: localize('Reset failed'),
    }[reset_state];

    const handleLogout = () => {
        clearStoredSession();
        oauth_session.clear();
        window.location.href = '/';
    };

    return (
        <header className='mw-premium-nav'>
            <div className='mw-premium-nav__left'>
                {/* Phone only - hidden at desktop widths by the stylesheet,
                    where there is room for the full bar and nothing to hide
                    behind a menu. */}
                <button
                    type='button'
                    className='mw-premium-nav__burger'
                    onClick={() => setIsDrawerOpen(true)}
                    aria-label={localize('Menu')}
                    aria-expanded={is_drawer_open}
                >
                    <StandaloneBarsRegularIcon iconSize='sm' />
                </button>

                <span className='mw-premium-nav__brand'>MaziwaTrader</span>

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
                                    {listed_accounts.map(account => {
                                        const is_selected = account.account_id === selected?.account_id;
                                        // Only the selected demo row, because that is the
                                        // account topup_virtual would actually credit.
                                        const can_reset = account.account_type === 'demo' && is_selected;
                                        return (
                                            <div
                                                key={account.account_id}
                                                className={`mw-premium-nav__panel-account ${is_selected ? 'mw-premium-nav__panel-account--active' : ''}`}
                                            >
                                                <button
                                                    type='button'
                                                    className='mw-premium-nav__panel-account-main'
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
                                                    {/* The reset button stands where the figure
                                                        would be, as Deriv's own switcher does. */}
                                                    {!can_reset && (
                                                        <span className='mw-premium-nav__panel-account-balance'>
                                                            {addComma(
                                                                Number(account.balance || 0).toFixed(
                                                                    getDecimalPlaces(account.currency)
                                                                )
                                                            )}{' '}
                                                            {account.currency}
                                                        </span>
                                                    )}
                                                </button>
                                                {can_reset && (
                                                    <button
                                                        type='button'
                                                        className={`mw-premium-nav__panel-account-reset mw-premium-nav__panel-account-reset--${reset_state}`}
                                                        onClick={resetDemoBalance}
                                                        disabled={reset_state === 'working'}
                                                        aria-live='polite'
                                                    >
                                                        {reset_label}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {reset_error && (
                                        <p className='mw-premium-nav__panel-reset-error' role='alert'>
                                            {reset_error}
                                        </p>
                                    )}
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

            {/* Handed the header's own logout, so there is one logout path. */}
            <MobileDrawer is_open={is_drawer_open} onClose={() => setIsDrawerOpen(false)} onLogout={handleLogout} />
        </header>
    );
});

export default OAuthFlatNav;
