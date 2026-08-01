import { useEffect, useState } from 'react';
import {
    feedConnectionState$,
    feedLatencyMs$,
    public_market_feed,
    TFeedConnectionState,
} from '@/utils/market-data/public-market-feed';

/** React state for Deriv's public Options WebSocket market-data feed (see public-market-feed.ts). */
export const usePublicMarketFeed = () => {
    const [connectionState, setConnectionState] = useState<TFeedConnectionState>(feedConnectionState$.getValue());
    const [latencyMs, setLatencyMs] = useState<number | null>(feedLatencyMs$.getValue());

    useEffect(() => {
        const connection_sub = feedConnectionState$.subscribe(setConnectionState);
        const latency_sub = feedLatencyMs$.subscribe(setLatencyMs);
        // Every mounted consumer holds its own reference so the socket stays
        // open as long as any of them needs it, regardless of which route
        // they're on - see PublicMarketFeed.acquire()/release().
        public_market_feed.acquire();
        return () => {
            connection_sub.unsubscribe();
            latency_sub.unsubscribe();
            public_market_feed.release();
        };
    }, []);

    return {
        connectionState,
        latencyMs,
        isConnected: connectionState === 'open',
        feed: public_market_feed,
    };
};

export default usePublicMarketFeed;
