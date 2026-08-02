import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces } from '@/components/shared';
import { useStore } from '@/hooks/useStore';
import { clearStoredSession } from '@/utils/auth/deriv-oauth';
import { StandaloneChevronDownRegularIcon, StandaloneRightFromBracketRegularIcon } from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import './oauth-account-switcher.scss';

/**
 * Real account switcher for the OAuth + Options API session - oauth_session.accounts
 * is the actual list of Options accounts linked to this Deriv login (both real and
 * demo), so Real/Demo tabs and balances here are genuine data, and selecting an
 * account calls the store's existing selectAccount() rather than simulating a switch.
 */
const OAuthAccountSwitcher = observer(() => {
    const { oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const [is_open, setIsOpen] = useState(false);
    const [active_tab, setActiveTab] = useState<'real' | 'demo'>(
        oauth_session?.account_type === 'demo' ? 'demo' : 'real'
    );
    const container_ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (container_ref.current && !container_ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!oauth_session) return null;

    const accounts = oauth_session.accounts ?? [];
    const real_accounts = accounts.filter(account => account.account_type === 'real');
    const demo_accounts = accounts.filter(account => account.account_type === 'demo');
    const tab_accounts = active_tab === 'real' ? real_accounts : demo_accounts;
    const selected = oauth_session.selected_account;
    const decimals = getDecimalPlaces(oauth_session.currency || 'USD');

    const handleLogout = () => {
        clearStoredSession();
        oauth_session.clear();
        window.location.href = '/';
    };

    return (
        <div className='oauth-account-switcher' ref={container_ref}>
            <button
                type='button'
                className='oauth-account-switcher__trigger'
                onClick={() => setIsOpen(prev => !prev)}
                aria-expanded={is_open}
            >
                <CurrencyIcon
                    currency={oauth_session.currency?.toLowerCase()}
                    isVirtual={oauth_session.account_type === 'demo'}
                />
                <span className='oauth-account-switcher__balance'>
                    {addComma(Number(oauth_session.balance || 0).toFixed(decimals))} {oauth_session.currency || '—'}
                </span>
                <StandaloneChevronDownRegularIcon
                    height={14}
                    width={14}
                    className={`oauth-account-switcher__chevron ${is_open ? 'oauth-account-switcher__chevron--open' : ''}`}
                />
            </button>

            {is_open && (
                <div className='oauth-account-switcher__panel'>
                    <div className='oauth-account-switcher__tabs'>
                        <button
                            type='button'
                            className={`oauth-account-switcher__tab ${active_tab === 'real' ? 'oauth-account-switcher__tab--active' : ''}`}
                            onClick={() => setActiveTab('real')}
                        >
                            {localize('Real')}
                        </button>
                        <button
                            type='button'
                            className={`oauth-account-switcher__tab ${active_tab === 'demo' ? 'oauth-account-switcher__tab--active' : ''}`}
                            onClick={() => setActiveTab('demo')}
                        >
                            {localize('Demo')}
                        </button>
                    </div>

                    <div className='oauth-account-switcher__list-header'>{localize('Deriv accounts')}</div>

                    <div className='oauth-account-switcher__list'>
                        {tab_accounts.length === 0 ? (
                            <p className='oauth-account-switcher__empty'>
                                {localize('No {{type}} accounts on this login.', {
                                    type: active_tab === 'real' ? localize('real') : localize('demo'),
                                })}
                            </p>
                        ) : (
                            tab_accounts.map(account => (
                                <button
                                    type='button'
                                    key={account.account_id}
                                    className={`oauth-account-switcher__account ${account.account_id === selected?.account_id ? 'oauth-account-switcher__account--active' : ''}`}
                                    onClick={() => {
                                        oauth_session.selectAccount(account.account_id);
                                        setIsOpen(false);
                                    }}
                                >
                                    <CurrencyIcon
                                        currency={account.currency?.toLowerCase()}
                                        isVirtual={account.account_type === 'demo'}
                                    />
                                    <span className='oauth-account-switcher__account-info'>
                                        <span className='oauth-account-switcher__account-currency'>
                                            {account.currency}
                                        </span>
                                        <span className='oauth-account-switcher__account-id'>{account.account_id}</span>
                                    </span>
                                    <span className='oauth-account-switcher__account-balance'>
                                        {addComma(
                                            Number(account.balance || 0).toFixed(getDecimalPlaces(account.currency))
                                        )}{' '}
                                        {account.currency}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>

                    <div className='oauth-account-switcher__divider' />

                    <button type='button' className='oauth-account-switcher__logout' onClick={handleLogout}>
                        {localize('Logout')}
                        <StandaloneRightFromBracketRegularIcon height={14} width={14} />
                    </button>
                </div>
            )}
        </div>
    );
});

export default OAuthAccountSwitcher;
