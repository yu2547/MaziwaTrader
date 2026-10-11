import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import FreeBots, { type Bot } from '../free-bots';
import StrategyGuide from './guide';
import { GUIDES } from './guides';
import { EvenIcon, HitAndRunIcon, OddIcon, OverUnderIcon } from './icons';
import './strategies.scss';

/**
 * The Strategies tab: four strategy cards over the slice of the bot catalogue
 * that trades the one you pick.
 *
 * This replaces a plain category-filtered view of ../free-bots, which showed
 * the same grid of bot cards as every other tab and so said nothing about the
 * strategies themselves.
 *
 * Explore Strategy opens the strategy's written guideline - see ./guides,
 * where the rules come from - followed by the bots in our own catalogue that
 * trade it. A strategy with no guideline yet simply opens onto its bots, so
 * the three still to be written need no change here when they arrive.
 */

const namesOdd = (bot: Bot) => /odd/i.test(bot.name);
const namesEven = (bot: Bot) => /even/i.test(bot.name);
const inEvenOdd = (bot: Bot) => bot.category === 'Even/Odd';

type TStrategy = {
    Icon: (props: { className?: string }) => JSX.Element;
    description: string;
    id: string;
    /**
     * Which bots this strategy opens. A predicate rather than a category name
     * because Even/Odd is one category in the catalogue and two cards here.
     */
    matches: (bot: Bot) => boolean;
    title: string;
};

const STRATEGIES: TStrategy[] = [
    {
        Icon: OverUnderIcon,
        description: localize(
            'Digit Over and Digit Under contracts: the bot predicts whether the last digit of the exit tick lands above or below a chosen digit.'
        ),
        id: 'over-under',
        matches: bot => bot.category === 'Over/Under',
        title: localize('Over/Under'),
    },
    {
        Icon: OddIcon,
        description: localize(
            'Digit Odd contracts: the bot predicts that the last digit of the exit tick is an odd number.'
        ),
        id: 'odd',
        // Split off the shared Even/Odd category by the bot's own name: a bot
        // that names only one of the two takes only that one, and a bot that
        // names both - or neither, like SignalSniper - belongs under each card.
        matches: bot => inEvenOdd(bot) && (namesOdd(bot) || !namesEven(bot)),
        title: localize('Odd'),
    },
    {
        Icon: EvenIcon,
        description: localize(
            'Digit Even contracts: the bot predicts that the last digit of the exit tick is an even number.'
        ),
        id: 'even',
        matches: bot => inEvenOdd(bot) && (namesEven(bot) || !namesOdd(bot)),
        title: localize('Even'),
    },
    {
        Icon: HitAndRunIcon,
        description: localize(
            'Quick in-and-out entries in the Over/Under market, each one validated against a 3-tick sequence before the trade is taken.'
        ),
        id: 'hit-and-run',
        // Over/Under, not Rise/Fall and the speed bots as this first read it:
        // the guideline that arrived for this card is an Over/Under technique
        // throughout - Over 1 and Under 8 - so those are the bots that trade
        // it. It overlaps the Over/Under card, which is right: same market,
        // different technique.
        matches: bot => bot.category === 'Over/Under',
        title: localize('Hit and Run'),
    },
];

const Strategies = observer(() => {
    const [open_id, setOpenId] = useState<string | null>(null);
    const open = STRATEGIES.find(strategy => strategy.id === open_id) ?? null;

    // Opening a strategy replaces the grid rather than growing beneath it:
    // the guideline runs long enough that the cards would only ever be
    // scrolled away from, and leaving them above pushes the thing just asked
    // for off the screen. Back To Strategies brings them back.
    if (open) {
        const guide = GUIDES[open.id];

        return (
            <div className='mw-strategies'>
                <button type='button' className='mw-strategies__back' onClick={() => setOpenId(null)}>
                    <svg
                        aria-hidden='true'
                        fill='none'
                        stroke='currentColor'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth='2'
                        viewBox='0 0 24 24'
                    >
                        <path d='M19 12H5M11 18l-6-6 6-6' />
                    </svg>
                    {localize('Back to Strategies')}
                </button>

                {guide && <StrategyGuide guide={guide} />}

                <div className='mw-strategies__bots'>
                    <h2 className='mw-strategies__bots-title'>
                        {localize('{{strategy}} bots', { strategy: open.title })}
                    </h2>
                    {/* bot_filter rather than allowed_categories: the scalpers
                        are kept out of the catalogue views by default, and Odd
                        and Even are mostly scalpers - filtered by category
                        these two cards would open onto almost nothing. */}
                    <FreeBots bot_filter={open.matches} />
                </div>
            </div>
        );
    }

    return (
        <div className='mw-strategies'>
            <div className='mw-strategies__header'>
                <h1 className='mw-strategies__title'>{localize('Advanced Trading Strategies')}</h1>
                <p className='mw-strategies__subtitle'>
                    {localize('Select a trading strategy to read its guideline and the bots that trade it.')}
                </p>
            </div>

            <div className='mw-strategies__grid'>
                {STRATEGIES.map(({ Icon, description, id, title }) => (
                    // A button rather than a div with a click handler, so the
                    // card is reachable and operable from the keyboard; its
                    // contents are spans for the same reason, since a button
                    // may only hold phrasing content.
                    <button
                        key={id}
                        type='button'
                        className={`mw-strategies__card mw-strategies__card--${id}`}
                        onClick={() => setOpenId(id)}
                    >
                        <span className='mw-strategies__card-icon'>
                            <Icon />
                        </span>
                        <span className='mw-strategies__card-title'>{title}</span>
                        <span className='mw-strategies__card-text'>{description}</span>
                        <span className='mw-strategies__card-cta'>
                            {localize('Explore Strategy')}
                            <svg
                                aria-hidden='true'
                                className='mw-strategies__card-arrow'
                                fill='none'
                                stroke='currentColor'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth='2'
                                viewBox='0 0 24 24'
                            >
                                <path d='M5 12h14M13 6l6 6-6 6' />
                            </svg>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
});

export default Strategies;
