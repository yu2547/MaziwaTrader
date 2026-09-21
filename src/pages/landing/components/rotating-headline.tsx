import { useEffect, useState } from 'react';
import { useTranslations } from '@deriv-com/translations';
import './rotating-headline.scss';

// The hero's headline and the line beneath it, cycling through six slides:
// each headline types itself out, holds, deletes, and the next one types in.
// A slide is always one headline with its own description - the description
// changes only at the instant the old headline has been fully deleted, so a
// fragment of one headline never sits over another's description.
//
// Timing, per slide: 45ms a character typed, 2.6s held, 28ms a character
// deleted, 0.3s empty before the next. About five seconds a slide, half a
// minute for the loop. Slow enough to read both lines, not so slow it drags.
const TYPE_MS = 45;
const HOLD_MS = 2600;
const DELETE_MS = 28;
const GAP_MS = 300;

type TPhase = 'typing' | 'holding' | 'deleting';

type TSlide = {
    // The headline's opening words, in white.
    lead: string;
    // The words it lands on, in the cyan gradient.
    accent: string;
    description: string;
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type TRotatingHeadlineProps = {
    // False while the loading screen still covers the page. Slide 1 is shown
    // complete until then, and its hold only starts counting once it can be
    // seen - otherwise part of it would be spent behind the loading screen.
    is_active: boolean;
};

const RotatingHeadline = ({ is_active }: TRotatingHeadlineProps) => {
    const { localize } = useTranslations();

    const slides: TSlide[] = [
        {
            lead: localize('Get access to'),
            accent: localize('free premium bots'),
            description: localize('Deploy ready-made trading bots and copy top performers, no coding required.'),
        },
        {
            lead: localize('Trade smarter,'),
            accent: localize('not harder'),
            description: localize('Automate repetitive strategies and stay focused on your plan, not the screen.'),
        },
        {
            lead: localize('Build for'),
            accent: localize('every kind of trader'),
            description: localize('From manual to full automation, MaziwaTrader adapts to the way you work.'),
        },
        {
            lead: localize('Welcome to'),
            accent: 'MaziwaTrader',
            description: localize(
                'Your all-in-one workspace for automated trading, smart bots, and real-time market insights.'
            ),
        },
        {
            lead: localize('Trade with'),
            accent: localize('better tools'),
            description: localize(
                'Professional grade charts, risk controls, and lightning-fast execution built for serious traders.'
            ),
        },
        {
            lead: localize('Simplify your'),
            accent: localize('market analysis'),
            description: localize(
                'Clear signals and real-time analytics help you spot opportunities without the guesswork.'
            ),
        },
    ];

    const fullText = (slide: TSlide) => `${slide.lead} ${slide.accent}`;

    // Starts on slide 1, complete: the headline is never blank, whether the
    // page is still behind the loading screen or motion is turned off.
    const [reduced_motion] = useState(prefersReducedMotion);
    const [index, setIndex] = useState(0);
    const [shown, setShown] = useState(() => fullText(slides[0]).length);
    const [phase, setPhase] = useState<TPhase>('holding');

    // One timer at a time: each step schedules the next and the cleanup
    // cancels whatever is pending, so leaving the page leaves nothing running.
    useEffect(() => {
        if (!is_active || reduced_motion) return undefined;

        const length = fullText(slides[index]).length;
        let delay: number;
        let step: () => void;

        if (phase === 'typing') {
            if (shown < length) {
                delay = TYPE_MS;
                step = () => setShown(value => value + 1);
            } else {
                delay = TYPE_MS;
                step = () => setPhase('holding');
            }
        } else if (phase === 'holding') {
            delay = HOLD_MS;
            step = () => setPhase('deleting');
        } else if (shown > 0) {
            delay = DELETE_MS;
            step = () => setShown(value => value - 1);
        } else {
            // Empty: this is the one moment the slide - headline and
            // description together - moves on.
            delay = GAP_MS;
            step = () => {
                setIndex(value => (value + 1) % slides.length);
                setPhase('typing');
            };
        }

        const timer = setTimeout(step, delay);
        return () => clearTimeout(timer);
        // slides is rebuilt each render from the same strings; its length and
        // text are what matter here, and index covers which one is current.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_active, reduced_motion, index, shown, phase]);

    const current = slides[index];
    const text = fullText(current);

    // The typed characters split at the end of the lead: the lead and the
    // space after it in white, the rest in the gradient.
    const white_part = text.slice(0, Math.min(shown, current.lead.length + 1));
    const accent_part = shown > current.lead.length + 1 ? text.slice(current.lead.length + 1, shown) : '';

    return (
        <div className='mw-rotator'>
            {/* What a screen reader hears: the first slide, as steady text.
                The typing below is hidden from it, so it is never read out a
                letter at a time or changed underneath the reader. */}
            <h1 className='mw-rotator__sr'>{fullText(slides[0])}</h1>
            <p className='mw-rotator__sr'>{slides[0].description}</p>

            {/* Every headline, full length and invisible, stacked in one cell
                with the typed one on top. The box is always as tall as the
                longest headline at the current width, so nothing below it -
                the call to action included - moves as the text changes. */}
            <div className='mw-rotator__headline' aria-hidden='true'>
                {slides.map(slide => (
                    <span className='mw-rotator__layer mw-rotator__sizer' key={slide.lead}>
                        {slide.lead} <span className='mw-rotator__accent'>{slide.accent}</span>
                        <i className='mw-rotator__caret' />
                    </span>
                ))}
                <span className='mw-rotator__layer mw-rotator__typed'>
                    {white_part}
                    {accent_part && <span className='mw-rotator__accent'>{accent_part}</span>}
                    <i className='mw-rotator__caret mw-rotator__caret--live' />
                </span>
            </div>

            {/* The same stacking for the descriptions. Only the current one
                is opaque, and the change is a short crossfade. */}
            <div className='mw-rotator__descriptions' aria-hidden='true'>
                {slides.map((slide, i) => (
                    <p
                        className={`mw-rotator__layer mw-rotator__description ${i === index ? 'mw-rotator__description--active' : ''}`}
                        key={slide.lead}
                    >
                        {slide.description}
                    </p>
                ))}
            </div>
        </div>
    );
};

export default RotatingHeadline;
