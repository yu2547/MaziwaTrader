import { useCallback } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import PWAInstallButton from '@/components/pwa-install-button';
import { redirectToLogin, redirectToSignUp, standalone_routes } from '@/components/shared';
import Button from '@/components/shared_ui/button';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useFirebaseCountriesConfig } from '@/hooks/firebase/useFirebaseCountriesConfig';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import { StandaloneCircleUserRegularIcon } from '@deriv/quill-icons/Standalone';
import { Localize, useTranslations } from '@deriv-com/translations';
import { Header, useDevice, Wrapper } from '@deriv-com/ui';
import { Tooltip } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import CustomNotifications from './custom-notifications/custom-notifications';
import AccountsInfoLoader from './account-info-loader';
import AccountSwitcher from './account-switcher';
import AccountTypeSelector from './account-type-selector';
import CurrencySelector from './currency-selector';
import HeaderClock from './HeaderClock';
import MenuItems from './menu-items';
import MobileMenu from './mobile-menu';
import OAuthAccountSwitcher from './oauth-account-switcher';
import RegionBadge from './region-badge';
import TelegramLink from './TelegramLink';
import YouTubeLink from './YouTubeLink';
import './header.scss';

type TAppHeaderProps = {
    isAuthenticating?: boolean;
};

const AppHeader = observer(({ isAuthenticating }: TAppHeaderProps) => {
    const { isDesktop } = useDevice();
    const { isAuthorizing, activeLoginid } = useApiBase();
    const { client, oauth_session } = useStore() ?? {};
    const is_oauth_only_session = !activeLoginid && !!oauth_session?.is_authenticated;

    const { data: activeAccount } = useActiveAccount({ allBalanceData: client?.all_accounts_balance });
    const { accounts, getCurrency, is_virtual } = client ?? {};
    const has_wallet = Object.keys(accounts ?? {}).some(id => accounts?.[id].account_category === 'wallet');

    const currency = getCurrency?.();
    const { localize } = useTranslations();
    const { isSingleLoggingIn } = useOauth2();

    const { hubEnabledCountryList } = useFirebaseCountriesConfig();
    const { onRenderTMBCheck, isTmbEnabled } = useTMB();
    const is_tmb_enabled = isTmbEnabled() || window.is_tmb_enabled === true;
    // No need for additional state management here since we're handling it in the layout component

    const renderAccountSection = useCallback(() => {
        // Show loader during authentication processes
        if (isAuthenticating || isAuthorizing || (isSingleLoggingIn && !is_tmb_enabled)) {
            return <AccountsInfoLoader isLoggedIn isMobile={!isDesktop} speed={3} />;
        } else if (is_oauth_only_session) {
            // A session authenticated via the new OAuth + Options API flow has
            // no legacy loginid, so it never satisfies the activeLoginid branch
            // below - without this, the header showed "Log in / Sign up" even
            // though the user was already signed in, with no way to log out.
            return (
                <div className='auth-actions'>
                    <CustomNotifications />
                    {isDesktop && <RegionBadge />}
                    <CurrencySelector />
                    <AccountTypeSelector />
                    {isDesktop && (
                        <Button
                            primary
                            onClick={() => {
                                const redirect_url = new URL(standalone_routes.cashier);
                                redirect_url.searchParams.set(
                                    'account',
                                    oauth_session?.account_type === 'demo' ? 'demo' : oauth_session?.currency || ''
                                );
                                window.location.assign(redirect_url.toString());
                            }}
                            className='withdraw-button'
                        >
                            {localize('Withdraw')}
                        </Button>
                    )}
                    <OAuthAccountSwitcher />
                    <HeaderClock />
                </div>
            );
        } else if (activeLoginid) {
            return (
                <>
                    <CustomNotifications />

                    {isDesktop &&
                        (has_wallet ? (
                            <Button
                                className='manage-funds-button'
                                has_effect
                                text={localize('Manage funds')}
                                onClick={() => {
                                    let redirect_url = new URL(standalone_routes.wallets_transfer);
                                    const is_hub_enabled_country = hubEnabledCountryList.includes(
                                        client?.residence || ''
                                    );
                                    if (is_hub_enabled_country) {
                                        redirect_url = new URL(standalone_routes.recent_transactions);
                                    }
                                    if (is_virtual) {
                                        redirect_url.searchParams.set('account', 'demo');
                                    } else if (currency) {
                                        redirect_url.searchParams.set('account', currency);
                                    }
                                    window.location.assign(redirect_url.toString());
                                }}
                                primary
                            />
                        ) : (
                            <Button
                                primary
                                onClick={() => {
                                    const redirect_url = new URL(standalone_routes.cashier_deposit);
                                    if (currency) {
                                        redirect_url.searchParams.set('account', currency);
                                    }
                                    window.location.assign(redirect_url.toString());
                                }}
                                className='deposit-button'
                            >
                                {localize('Deposit')}
                            </Button>
                        ))}

                    <div className='app-header__balance-pill'>
                        <AccountSwitcher activeAccount={activeAccount} />
                    </div>

                    <HeaderClock />

                    {isDesktop &&
                        (() => {
                            let redirect_url = new URL(standalone_routes.personal_details);
                            const is_hub_enabled_country = hubEnabledCountryList.includes(client?.residence || '');

                            if (has_wallet && is_hub_enabled_country) {
                                redirect_url = new URL(standalone_routes.account_settings);
                            }
                            // Check if the account is a demo account
                            // Use the URL parameter to determine if it's a demo account, as this will update when the account changes
                            const urlParams = new URLSearchParams(window.location.search);
                            const account_param = urlParams.get('account');
                            const is_virtual = client?.is_virtual || account_param === 'demo';

                            if (is_virtual) {
                                // For demo accounts, set the account parameter to 'demo'
                                redirect_url.searchParams.set('account', 'demo');
                            } else if (currency) {
                                // For real accounts, set the account parameter to the currency
                                redirect_url.searchParams.set('account', currency);
                            }
                            return (
                                <Tooltip
                                    as='a'
                                    href={redirect_url.toString()}
                                    tooltipContent={localize('Manage account settings')}
                                    tooltipPosition='bottom'
                                    className='app-header__account-settings app-header__avatar'
                                >
                                    <span className='app-header__avatar-inner'>
                                        <StandaloneCircleUserRegularIcon className='app-header__profile_icon' />
                                    </span>
                                </Tooltip>
                            );
                        })()}
                </>
            );
        } else {
            return (
                <div className='auth-actions'>
                    <HeaderClock />
                    <Button
                        tertiary
                        onClick={async () => {
                            redirectToLogin(false);
                        }}
                    >
                        <Localize i18n_default_text='Log in' />
                    </Button>
                    <Button
                        primary
                        onClick={() => {
                            redirectToSignUp();
                        }}
                    >
                        <Localize i18n_default_text='Sign up' />
                    </Button>
                </div>
            );
        }
    }, [
        isAuthenticating,
        isAuthorizing,
        isSingleLoggingIn,
        isDesktop,
        activeLoginid,
        is_oauth_only_session,
        oauth_session,
        standalone_routes,
        client,
        has_wallet,
        currency,
        localize,
        activeAccount,
        is_virtual,
        onRenderTMBCheck,
        is_tmb_enabled,
    ]);

    if (client?.should_hide_header) return null;
    return (
        <Header
            className={clsx('app-header', {
                'app-header--desktop': isDesktop,
                'app-header--mobile': !isDesktop,
            })}
        >
            <Wrapper variant='left'>
                <AppLogo />
                <MobileMenu />
                {isDesktop && <MenuItems.TradershubLink />}
                {isDesktop && <MenuItems />}
            </Wrapper>
            <Wrapper variant='right'>
                {isDesktop && <TelegramLink />}
                {isDesktop && <YouTubeLink />}
                {!isDesktop && <PWAInstallButton variant='primary' size='medium' />}
                {renderAccountSection()}
            </Wrapper>
            {/* <PWAInstallModalTest /> */}
        </Header>
    );
});

export default AppHeader;
