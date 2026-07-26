import { useEffect, useState } from 'react';

// Decorative floating tickers - not real market data, just small periodic
// nudges so the hero feels alive without pretending to be a live feed.
const SYMBOLS = [
    { name: 'VOL100', base: 2143.68 },
    { name: 'R_100', base: 2143.08 },
    { name: 'BOOM 500', base: 2242.67 },
];

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const HeroMarketCards = () => {
    const [values, setValues] = useState(() => SYMBOLS.map(s => ({ value: s.base, dir: 1 as 1 | -1 })));

    useEffect(() => {
        if (prefersReducedMotion()) return undefined;
        const id = setInterval(() => {
            setValues(prev =>
                prev.map(v => {
                    const delta = (Math.random() - 0.42) * 1.1;
                    return { value: Math.max(0, v.value + delta), dir: delta >= 0 ? 1 : -1 };
                })
            );
        }, 2200);
        return () => clearInterval(id);
    }, []);

    return (
        <div className='mw-hero__cards' aria-hidden='true'>
            {SYMBOLS.map((symbol, i) => (
                <div className={`mw-hero__card mw-hero__card--${i}`} key={symbol.name}>
                    <span className='mw-hero__card-name'>{symbol.name}</span>
                    <span
                        className={`mw-hero__card-value ${values[i].dir > 0 ? 'mw-hero__card-value--up' : 'mw-hero__card-value--down'}`}
                    >
                        {values[i].value.toFixed(2)}
                    </span>
                </div>
            ))}
        </div>
    );
};

export default HeroMarketCards;
