import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
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

const LATENCY_PROBE_INTERVAL = 15000;

const useServerLatency = (is_connected: boolean) => {
    const [latency, setLatency] = useState<number | null>(null);
    const [last_sync, setLastSync] = useState<Date | null>(null);
    const probing = useRef(false);

    useEffect(() => {
        if (!is_connected) return undefined;

        const probe = async () => {
            if (probing.current) return;
            probing.current = true;
            const start = performance.now();
            try {
                await api_base.api?.send({ ping: 1 });
                setLatency(Math.round(performance.now() - start));
                setLastSync(new Date());
            } catch {
                // Non-critical UI metric - ignore failures silently.
            } finally {
                probing.current = false;
            }
        };

        probe();
        const id = setInterval(probe, LATENCY_PROBE_INTERVAL);
        return () => clearInterval(id);
    }, [is_connected]);

    return { latency, last_sync };
};

const LiveInfoCards = observer(() => {
    const { client } = useStore();
    const { connectionStatus } = useApiBase();
    const { localize } = useTranslations();
    const is_connected = connectionStatus === CONNECTION_STATUS.OPENED;
    const { latency, last_sync } = useServerLatency(is_connected);

    const items = [
        {
            id: 'connection',
            icon: <StandaloneWifiRegularIcon height='20px' width='20px' />,
            label: localize('Connection status'),
            value: is_connected ? localize('Stable') : localize('Reconnecting'),
            tone: is_connected ? 'good' : 'warn',
        },
        {
            id: 'market',
            icon: <StandaloneCircleDotRegularIcon height='20px' width='20px' />,
            label: localize('Market status'),
            value: localize('Open'),
            tone: 'good',
        },
        {
            id: 'latency',
            icon: <StandaloneChartLineRegularIcon height='20px' width='20px' />,
            label: localize('Server latency'),
            value: latency !== null ? `${latency} ms` : localize('Measuring…'),
            tone: latency !== null && latency < 300 ? 'good' : 'neutral',
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
            value: client.currency || '—',
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
