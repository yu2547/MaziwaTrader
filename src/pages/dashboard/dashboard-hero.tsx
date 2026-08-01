import { observer } from 'mobx-react-lite';
import { addComma, getDecimalPlaces } from '@/components/shared';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import {
    StandaloneCircleCheckRegularIcon,
    StandaloneTriangleExclamationRegularIcon,
} from '@deriv/quill-icons/Standalone';
import { Localize, useTranslations } from '@deriv-com/translations';
import LiveInfoCards from './live-info-cards';
import './dashboard-hero.scss';

const getGreeting = (hour: number) => {
    if (hour < 5) return 'Good Night';
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
};

const DashboardHero = observer(() => {
    const { client, oauth_session } = useStore();
    const { connectionStatus } = useApiBase();
    const { isConnected: is_feed_connected } = usePublicMarketFeed();
    const { localize } = useTranslations();

    // The OAuth + Options API session is the primary source once it's
    // authenticated; it never overlaps with the legacy client store (that one
    // is keyed on loginid data this session never has), so this is a plain
    // either/or rather than a merge.
    const is_oauth_session = oauth_session.is_authenticated;
    const display_loginid = is_oauth_session ? oauth_session.account_id : client.loginid;
    const display_currency = is_oauth_session ? oauth_session.currency : client.currency;
    const display_balance = is_oauth_session ? oauth_session.balance : Number(client.balance || 0);
    const is_demo_account = is_oauth_session ? oauth_session.account_type === 'demo' : client.is_virtual;

    const greeting = getGreeting(new Date().getUTCHours());

    const decimals = getDecimalPlaces(display_currency);
    const formatted_balance = addComma(Number(display_balance || 0).toFixed(decimals));
    const account_type = is_demo_account ? localize('Demo account') : localize('Real account');
    // The classic connection and the public market feed are two independent
    // sockets - an OAuth session only ever has the feed, so "Server status"
    // reflects whichever one this session actually depends on, rather than
    // always claiming "Live" regardless of what's really connected.
    const is_connected = is_oauth_session ? is_feed_connected : connectionStatus === CONNECTION_STATUS.OPENED;

    return (
        <section className='mw-hero' aria-label={localize('Account overview')}>
            <div className='mw-hero__top'>
                <div className='mw-hero__greeting-block'>
                    <h1 className='mw-hero__greeting'>
                        <Localize
                            i18n_default_text='{{greeting}}, {{loginid}} {{wave}}'
                            values={{ greeting: localize(greeting), loginid: display_loginid || '—', wave: '👋' }}
                        />
                    </h1>
                    <p className='mw-hero__subtitle'>
                        <Localize i18n_default_text='Here is what’s happening with your account today.' />
                    </p>
                </div>
            </div>

            <div className='mw-hero__stats'>
                <div className='mw-hero__stat mw-hero__stat--primary'>
                    <span className='mw-hero__stat-label'>
                        <Localize i18n_default_text='Account balance' />
                    </span>
                    <span className='mw-hero__stat-value'>
                        {formatted_balance} <span className='mw-hero__stat-currency'>{display_currency}</span>
                    </span>
                </div>
                <div className='mw-hero__stat'>
                    <span className='mw-hero__stat-label'>
                        <Localize i18n_default_text='Account type' />
                    </span>
                    <span className='mw-hero__stat-value mw-hero__stat-value--small'>{account_type}</span>
                </div>
                <div className='mw-hero__stat'>
                    <span className='mw-hero__stat-label'>
                        <Localize i18n_default_text='Server status' />
                    </span>
                    <span
                        className={`mw-hero__status-pill ${is_connected ? 'mw-hero__status-pill--online' : 'mw-hero__status-pill--offline'}`}
                    >
                        {is_connected ? (
                            <StandaloneCircleCheckRegularIcon height='14px' width='14px' />
                        ) : (
                            <StandaloneTriangleExclamationRegularIcon height='14px' width='14px' />
                        )}
                        {is_connected ? localize('Live') : localize('Reconnecting')}
                    </span>
                </div>
            </div>

            {is_oauth_session && !client.is_logged_in && (
                <p className='mw-hero__notice'>
                    <Localize i18n_default_text='Signed in with your Deriv account. Bot Builder and Charts require the classic Deriv connection and are not available on this session yet - Analysis Tool and Free Bots work as usual.' />
                </p>
            )}

            <LiveInfoCards />
        </section>
    );
});

export default DashboardHero;
