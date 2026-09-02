import { useEffect, useMemo, useRef, useState } from 'react';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import './ai-scan.scss';

/** Volatility indices only. */
const VOLATILITY_SYMBOL = /^(R_\d+|1HZ\d+V)$/;

/** The window every percentage on this panel is counted over. */
const SAMPLE = 1000;

/** Gap between each market's history request, so a dozen do not fire together. */
const STAGGER_MS = 180;

/** The least time between two spoken lines, however fast the leader changes. */
const SPEAK_GAP_MS = 12000;

type TMarket = {
    counts: number[];
    current: number | null;
    decimals: number;
    name: string;
    price: number | null;
    sample: number;
    symbol: string;
};

/** Percentage share of each digit, over whatever sample the market has. */
const shares = (market: TMarket) => {
    const total = market.sample || 1;
    return market.counts.map(count => (count / total) * 100);
};

/**
 * The market whose distribution is furthest from flat, and the digit carrying
 * it. This is a description of the ticks already counted - the digit that has
 * come up most over the sample - and nothing else. It does not predict the
 * next digit and it is not a claim that entering here wins.
 */
const focusOf = (markets: TMarket[]) => {
    let best: { digit: number; market: TMarket; pct: number } | null = null;
    markets.forEach(market => {
        if (market.sample < SAMPLE) return;
        const pct = shares(market);
        const top = pct.reduce((high, value, digit) => (value > pct[high] ? digit : high), 0);
        if (!best || pct[top] > best.pct) best = { digit: top, market, pct: pct[top] };
    });
    return best as { digit: number; market: TMarket; pct: number } | null;
};

const AiScan = ({ onNormalView }: { onNormalView: () => void }) => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { localize } = useTranslations();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [markets, setMarkets] = useState<Record<string, TMarket>>({});
    const [speaking, setSpeaking] = useState(false);

    const markets_ref = useRef<Record<string, TMarket>>({});
    const spoken_ref = useRef<{ at: number; key: string }>({ at: 0, key: '' });

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => setSymbols(list.filter(item => VOLATILITY_SYMBOL.test(item.underlying_symbol))))
            .catch(() => {
                // Non-fatal: the panel stays on its waiting line.
            });
    }, [isConnected, feed]);

    // Seeded from history so every percentage is over a full sample the moment
    // it appears, then kept current from the live stream. Same feed the rest of
    // the app holds open - no second socket.
    useEffect(() => {
        if (!isConnected || !symbols.length) return undefined;

        let cancelled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const unsubscribes: (() => void)[] = [];

        const write = (symbol: string, market: TMarket) => {
            markets_ref.current = { ...markets_ref.current, [symbol]: market };
            setMarkets(markets_ref.current);
        };

        symbols.forEach((item, index) => {
            const symbol = item.underlying_symbol;
            const name = item.underlying_symbol_name;

            timers.push(
                setTimeout(() => {
                    if (cancelled) return;

                    feed.getTickHistory(symbol, SAMPLE)
                        .then(({ pip_size, prices }) => {
                            if (cancelled) return;
                            const decimals = toDecimalPlaces(pip_size) ?? 2;
                            const counts = new Array(10).fill(0);
                            prices.forEach(price => {
                                counts[getLastDigit(price, decimals)] += 1;
                            });
                            write(symbol, {
                                counts,
                                current: prices.length ? getLastDigit(prices[prices.length - 1], decimals) : null,
                                decimals,
                                name,
                                price: prices[prices.length - 1] ?? null,
                                sample: prices.length,
                                symbol,
                            });
                        })
                        .catch(() => {
                            // Non-fatal: this market simply shows nothing yet.
                        });

                    unsubscribes.push(
                        feed.subscribeTicks(symbol, tick => {
                            if (cancelled) return;
                            const previous = markets_ref.current[symbol];
                            if (!previous) return;
                            const decimals = toDecimalPlaces(tick.pip_size) ?? previous.decimals;
                            const digit = getLastDigit(tick.quote, decimals);
                            // The window is held at SAMPLE, so the percentages
                            // never quietly become an average of more ticks than
                            // the panel says they cover.
                            const counts = [...previous.counts];
                            counts[digit] += 1;
                            let sample = previous.sample + 1;
                            if (sample > SAMPLE) {
                                sample = SAMPLE;
                                const total = counts.reduce((sum, value) => sum + value, 0);
                                const scale = SAMPLE / total;
                                for (let i = 0; i < counts.length; i++) counts[i] = counts[i] * scale;
                            }
                            write(symbol, { ...previous, counts, current: digit, decimals, price: tick.quote, sample });
                        })
                    );
                }, index * STAGGER_MS)
            );
        });

        return () => {
            cancelled = true;
            timers.forEach(timer => clearTimeout(timer));
            unsubscribes.forEach(stop => stop());
        };
    }, [isConnected, feed, symbols]);

    const list = useMemo(() => Object.values(markets).sort((a, b) => a.name.localeCompare(b.name)), [markets]);
    const focus = useMemo(() => focusOf(list), [list]);

    /**
     * Speaks the reading when the leading market or its digit changes, and no
     * more often than SPEAK_GAP_MS however fast that happens.
     *
     * The orb below pulses only while this is actually speaking - it is driven
     * by the utterance's own start and end, not by a timer guessing at them, so
     * it cannot be pulsing while nothing is being said.
     */
    useEffect(() => {
        if (!focus) return;
        const synth = window.speechSynthesis;
        if (!synth) return;

        const key = `${focus.market.symbol}|${focus.digit}`;
        const now = Date.now();
        if (key === spoken_ref.current.key || now - spoken_ref.current.at < SPEAK_GAP_MS) return;
        spoken_ref.current = { at: now, key };

        const line = localize(
            '{{market}}. Digit {{digit}} is the most frequent, at {{pct}} percent of the last {{sample}} ticks.',
            {
                digit: focus.digit,
                market: focus.market.name,
                pct: focus.pct.toFixed(1),
                sample: SAMPLE,
            }
        );

        const utterance = new SpeechSynthesisUtterance(line);
        utterance.rate = 0.98;
        utterance.onstart = () => setSpeaking(true);
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        synth.speak(utterance);
    }, [focus, localize]);

    // Stops mid-sentence when the panel closes, rather than talking over a page
    // the trader has already left.
    useEffect(
        () => () => {
            window.speechSynthesis?.cancel();
            setSpeaking(false);
        },
        []
    );

    return (
        <div className='mw-ai'>
            <div className='mw-ai__bar'>
                <button type='button' className='mw-ai__pill' onClick={onNormalView}>
                    {localize('Normal View')}
                </button>
                <span className='mw-ai__pill mw-ai__pill--on'>{localize('AI Active')}</span>
                <p className='mw-ai__focus'>
                    {focus
                        ? localize(
                              'Focus market: {{market}} — digit {{digit}} at {{pct}}% of the last {{sample}} ticks.',
                              {
                                  digit: focus.digit,
                                  market: focus.market.name,
                                  pct: focus.pct.toFixed(1),
                                  sample: SAMPLE,
                              }
                          )
                        : localize('Reading the markets...')}
                </p>
            </div>

            {/* Only on screen while something is being said, which is what makes
                it mean anything when it does appear. */}
            {speaking && <div className='mw-ai__orb' aria-hidden='true' />}

            {list.length === 0 ? (
                <p className='mw-ai__waiting'>{localize('Waiting for market data...')}</p>
            ) : (
                <div className='mw-ai__markets'>
                    {list.map(market => {
                        const pct = shares(market);
                        const high = pct.reduce((best, value, digit) => (value > pct[best] ? digit : best), 0);
                        const low = pct.reduce((best, value, digit) => (value < pct[best] ? digit : best), 0);
                        return (
                            <section key={market.symbol} className='mw-ai__market'>
                                <header>{market.name}</header>
                                <div className='mw-ai__body'>
                                    <div className='mw-ai__price'>
                                        <span>
                                            {market.price === null ? '--' : market.price.toFixed(market.decimals)}
                                        </span>
                                        <b>{market.current ?? '--'}</b>
                                    </div>
                                    <div className='mw-ai__meta'>
                                        <span>
                                            {localize('Last {{sample}} ticks digit distribution', { sample: SAMPLE })}
                                        </span>
                                        <i>
                                            {Math.round(market.sample)}/{SAMPLE}
                                        </i>
                                    </div>
                                    <div className='mw-ai__digits'>
                                        {pct.map((value, digit) => {
                                            const tone =
                                                digit === market.current
                                                    ? 'current'
                                                    : digit === high
                                                      ? 'high'
                                                      : digit === low
                                                        ? 'low'
                                                        : '';
                                            return (
                                                <span
                                                    key={digit}
                                                    className={`mw-ai__digit${tone ? ` mw-ai__digit--${tone}` : ''}`}
                                                >
                                                    <b>{digit}</b>
                                                    <i>{value.toFixed(1)}%</i>
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            <p className='mw-ai__note'>
                {localize(
                    'Every percentage here is counted from real ticks, and the focus market is simply the one whose distribution is furthest from flat right now. It describes ticks that have already printed - it does not predict the next digit.'
                )}
            </p>
        </div>
    );
};

export default AiScan;
