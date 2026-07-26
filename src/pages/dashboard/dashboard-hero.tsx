import { observer } from 'mobx-react-lite';
import { addComma, getDecimalPlaces } from '@/components/shared';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useUtcClock from '@/hooks/useUtcClock';
import { StandaloneCircleCheckRegularIcon, StandaloneTriangleExclamationRegularIcon } from '@deriv/quill-icons/Standalone';
import { Localize, useTranslations } from '@deriv-com/translations';
import LiveInfoCards from './live-info-cards';
import './dashboard-hero.scss';

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };

const getGreeting = (hour: number) => {
    if (hour < 5) return 'Good Night';
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
};

const DashboardHero = observer(() => {
    const { client } = useStore();
    const { connectionStatus } = useApiBase();
    const { localize } = useTranslations();
    const now = useUtcClock();

    const greeting = getGreeting(now.getUTCHours());
    const gmt_time = now.toLocaleTimeString('en-GB', { ...TIME_FORMAT, timeZone: 'UTC' });
    const today = now.toLocaleDateString('en-GB', DATE_FORMAT);

    const decimals = getDecimalPlaces(client.currency);
    const formatted_balance = addComma(Number(client.balance || 0).toFixed(decimals));
    const account_type = client.is_virtual ? localize('Demo account') : localize('Real account');
    const is_connected = connectionStatus === CONNECTION_STATUS.OPENED;

    return (
        <section className='mw-hero' aria-label={localize('Account overview')}>
            <div className='mw-hero__top'>
                <div className='mw-hero__greeting-block'>
                    <h1 className='mw-hero__greeting'>
                        <Localize
                            i18n_default_text='{{greeting}}, {{loginid}} {{wave}}'
                            values={{ greeting: localize(greeting), loginid: client.loginid || '—', wave: '👋' }}
                        />
                    </h1>
                    <p className='mw-hero__subtitle'>
                        <Localize i18n_default_text='Here is what’s happening with your account today.' />
                    </p>
                </div>
                <div className='mw-hero__clock-block'>
                    <span className='mw-hero__date'>{today}</span>
                    <span className='mw-hero__gmt'>
                        {gmt_time} <span className='mw-hero__gmt-label'>GMT</span>
                    </span>
                </div>
            </div>

            <div className='mw-hero__stats'>
                <div className='mw-hero__stat mw-hero__stat--primary'>
                    <span className='mw-hero__stat-label'>
                        <Localize i18n_default_text='Account balance' />
                    </span>
                    <span className='mw-hero__stat-value'>
                        {formatted_balance} <span className='mw-hero__stat-currency'>{client.currency}</span>
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

            <LiveInfoCards />
        </section>
    );
});

export default DashboardHero;
