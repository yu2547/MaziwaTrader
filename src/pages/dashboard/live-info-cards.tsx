import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import {
    StandaloneChartLineRegularIcon,
    StandaloneCircleDollarRegularIcon,
    StandaloneCircleDotRegularIcon,
    StandaloneClockThreeRegularIcon,
    StandaloneWifiRegularIcon,
} from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import './live-info-cards.scss';

/**
 * Backed by Deriv's public Options WebSocket (usePublicMarketFeed), not the
 * classic socket - this is real for every session type (classic-token or
 * OAuth), since the public feed needs no auth. See public-market-feed.ts.
 */
const LiveInfoCards = observer(() => {
    const { client, oauth_session } = useStore();
    const { isConnected, latencyMs, feed } = usePublicMarketFeed();
    const { localize } = useTranslations();
    const [last_sync, setLastSync] = useState<Date | null>(null);
    const [market_open, setMarketOpen] = useState<boolean | null>(null);
    const display_currency = oauth_session.is_authenticated ? oauth_session.currency : client.currency;

    useEffect(() => {
        if (latencyMs !== null) setLastSync(new Date());
    }, [latencyMs]);

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(symbols => setMarketOpen(symbols.some(symbol => symbol.exchange_is_open === 1)))
            .catch(() => setMarketOpen(null));
    }, [isConnected, feed]);

    const items = [
        {
            id: 'connection',
            icon: <StandaloneWifiRegularIcon height='20px' width='20px' />,
            label: localize('Connection status'),
            value: isConnected ? localize('Stable') : localize('Reconnecting'),
            tone: isConnected ? 'good' : 'warn',
        },
        {
            id: 'market',
            icon: <StandaloneCircleDotRegularIcon height='20px' width='20px' />,
            label: localize('Market status'),
            value: market_open === null ? localize('—') : market_open ? localize('Open') : localize('Closed'),
            tone: market_open ? 'good' : 'neutral',
        },
        {
            id: 'latency',
            icon: <StandaloneChartLineRegularIcon height='20px' width='20px' />,
            label: localize('Server latency'),
            value: latencyMs !== null ? `${latencyMs} ms` : localize('Measuring…'),
            tone: latencyMs !== null && latencyMs < 300 ? 'good' : 'neutral',
        },
        {
            id: 'sync',
            icon: <StandaloneClockThreeRegularIcon height='20px' width='20px' />,
            label: localize('Last sync'),
            value: last_sync ? last_sync.toLocaleTimeString('en-GB', { hour12: false }) : localize('—'),
            tone: 'neutral',
        },
        {
            id: 'currency',
            icon: <StandaloneCircleDollarRegularIcon height='20px' width='20px' />,
            label: localize('Account currency'),
            value: display_currency || '—',
            tone: 'neutral',
        },
    ] as const;

    return (
        <div className='mw-live-info' role='list'>
            {items.map(item => (
                <div className={`mw-live-info__card mw-live-info__card--${item.tone}`} key={item.id} role='listitem'>
                    <span className='mw-live-info__icon'>{item.icon}</span>
                    <div className='mw-live-info__text'>
                        <span className='mw-live-info__label'>{item.label}</span>
                        <span className='mw-live-info__value'>{item.value}</span>
                    </div>
                </div>
            ))}
        </div>
    );
});

export default LiveInfoCards;
