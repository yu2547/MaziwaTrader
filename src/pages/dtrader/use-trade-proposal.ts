import { useEffect, useRef, useState } from 'react';
import { public_market_feed, TProposalResponse } from '@/utils/market-data/public-market-feed';
import { buildTradeRequest, TTradeParams, TTradeType } from './trade-types';

/**
 * Deriv's own price for the ticket as it currently stands.
 *
 * Asked of the public pricing endpoint the app already holds open, which
 * answers `proposal` without a session - so the payout, the barrier Deriv
 * picked, the stake limits and the maximum payout are all on screen before
 * anyone logs in, and all of them are Deriv's numbers. Nothing is estimated
 * here: when the request cannot be priced, the panel shows Deriv's own
 * refusal instead of a figure of our own.
 *
 * The request built here is the request the Buy button sends, so what is
 * quoted is what is bought.
 */

// Re-priced on this cadence as well as on every change, so a payout that has
// been sitting on screen is never stale by more than a few seconds.
const REPRICE_MS = 5000;

/**
 * Turbos price from a payout per point, and only from the handful of values
 * Deriv offers - which it names when it refuses one:
 * "Available payout per points are 0.35, 0.28, 0.21, 0.14, 0.07."
 * That list is the control's options, so it is read back out of the refusal
 * rather than guessed at.
 */
const readOfferedValues = (message?: string): string[] => {
    if (!message || !/available payout per points/i.test(message)) return [];
    return message.match(/\d+\.?\d*/g) ?? [];
};

type TArgs = {
    currency: string;
    params: TTradeParams;
    side_index: number;
    symbol: string;
    type: TTradeType;
};

const useTradeProposal = ({ currency, params, side_index, symbol, type }: TArgs) => {
    const [response, setResponse] = useState<TProposalResponse | null>(null);
    const [offered_payouts_per_point, setOfferedPayoutsPerPoint] = useState<string[]>([]);
    const [is_pricing, setIsPricing] = useState(false);
    const request_id = useRef(0);

    // The built request, as a string, so the effect re-runs when any field in
    // it actually changes rather than on every render of the params object.
    const request = buildTradeRequest(type, side_index, params, currency);
    const request_key = JSON.stringify(request);

    useEffect(() => {
        const id = ++request_id.current;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancelled = false;

        // The previous contract's quote is not this contract's quote. Held on
        // screen while the new one is in flight, it read as a payout for the
        // ticket now showing - measured: switching from Matches/Differs to
        // Rise/Fall left 8.93 USD on a contract that pays 1.95. It goes the
        // moment the ticket changes, and comes back with Deriv's answer.
        setResponse(null);

        const price = async () => {
            if (cancelled) return;
            setIsPricing(true);
            try {
                const result = await public_market_feed.getProposal({
                    ...JSON.parse(request_key),
                    underlying_symbol: symbol,
                });
                if (cancelled || id !== request_id.current) return;

                const offered = readOfferedValues(result.error?.message);
                if (offered.length) setOfferedPayoutsPerPoint(offered);
                setResponse(result);
            } catch {
                if (!cancelled && id === request_id.current) {
                    // A transport failure is not a refusal by Deriv, so it
                    // leaves the last quote alone rather than replacing it
                    // with a message the trader cannot act on.
                    setResponse(current => current);
                }
            } finally {
                if (!cancelled && id === request_id.current) {
                    setIsPricing(false);
                    timer = setTimeout(price, REPRICE_MS);
                }
            }
        };

        price();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [request_key, symbol]);

    return {
        error: response?.error?.message ?? null,
        is_pricing,
        offered_payouts_per_point,
        proposal: response?.proposal ?? null,
        request,
    };
};

export default useTradeProposal;
