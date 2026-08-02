import { useEffect, useState } from 'react';

/**
 * Live USD-base exchange rates from open.er-api.com (free, no API key,
 * confirmed reachable - required both a CSP connect-src allowance and a
 * public/sw.js exemption, since the app's own service worker was silently
 * replacing the fetch with a synthetic offline response). Rates update once
 * a day on the provider's side, so polling more than hourly would be
 * pointless; this refreshes every 30 minutes and caches in module scope so
 * every consumer shares one fetch instead of each firing its own.
 */
const EXCHANGE_RATE_URL = 'https://open.er-api.com/v6/latest/USD';
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];

type TRatesState = {
    rates: Record<string, number> | null;
    is_loading: boolean;
    error: string | null;
    updated_at: number | null;
};

let cached_state: TRatesState = { rates: null, is_loading: false, error: null, updated_at: null };
const listeners = new Set<(state: TRatesState) => void>();

const notify = () => listeners.forEach(listener => listener(cached_state));

const setState = (partial: Partial<TRatesState>) => {
    cached_state = { ...cached_state, ...partial };
    notify();
};

let fetch_promise: Promise<void> | null = null;
let retry_attempt = 0;
let retry_timer: ReturnType<typeof setTimeout> | null = null;

const fetchRates = async () => {
    if (fetch_promise) return fetch_promise;
    setState({ is_loading: true, error: null });
    fetch_promise = fetch(EXCHANGE_RATE_URL)
        .then(async response => {
            if (!response.ok) throw new Error(`Exchange rate API returned ${response.status}`);
            const data = (await response.json()) as { result?: string; rates?: Record<string, number> };
            if (data.result !== 'success' || !data.rates) throw new Error('Exchange rate API returned no rates');
            retry_attempt = 0;
            setState({ rates: data.rates, is_loading: false, error: null, updated_at: Date.now() });
        })
        .catch((error: Error) => {
            setState({ is_loading: false, error: error.message });
            // A transient failure (e.g. brief network hiccup) shouldn't leave
            // the selector stuck showing "unavailable" for up to 30 minutes -
            // back off quickly instead, then fall back to normal polling once
            // the short retry budget is spent.
            if (retry_attempt < RETRY_DELAYS_MS.length) {
                const delay = RETRY_DELAYS_MS[retry_attempt];
                retry_attempt += 1;
                if (retry_timer) clearTimeout(retry_timer);
                retry_timer = setTimeout(fetchRates, delay);
            }
        })
        .finally(() => {
            fetch_promise = null;
        });
    return fetch_promise;
};

let refresh_timer: ReturnType<typeof setInterval> | null = null;

const ensurePolling = () => {
    if (refresh_timer) return;
    fetchRates();
    refresh_timer = setInterval(fetchRates, REFRESH_INTERVAL_MS);
};

/** Live USD -> target-currency rates, e.g. useExchangeRates().rates?.KES */
export const useExchangeRates = () => {
    const [state, setLocalState] = useState(cached_state);

    useEffect(() => {
        listeners.add(setLocalState);
        ensurePolling();
        return () => {
            listeners.delete(setLocalState);
        };
    }, []);

    return state;
};

export const convertFromUsd = (amount_usd: number, rates: Record<string, number> | null, target_currency: string) => {
    if (target_currency === 'USD') return amount_usd;
    const rate = rates?.[target_currency];
    if (!rate) return null;
    return amount_usd * rate;
};
