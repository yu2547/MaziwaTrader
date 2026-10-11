import { localize } from '@deriv-com/translations';

/**
 * The written guideline each strategy card opens.
 *
 * Data rather than markup, so a strategy with no guideline yet simply has no
 * entry here and opens onto its bots alone.
 *
 * A guide is a list of sections and a section a list of blocks, because the
 * four written so far are not one shape: Over/Under is a labelled list, an
 * entry box and a call to action per set-up; Odd and Even are conditions, an
 * entry note and a colour key under a banner; Hit and Run is a long document
 * with prose sections, a numbered list and two prediction panels.
 *
 * Case belongs to the text, not to a stylesheet rule. It was briefly applied
 * in CSS, which worked while the first three guides shouted their headings
 * and labels - and then Hit and Run arrived in title case throughout, and
 * every one of those rules needed an exception. The reference's own case is
 * now written here, and the stylesheet only shouts the two things every guide
 * shouts: the top heading and the closing banner.
 *
 * The rules are the reference's, kept exactly: the same digits, the same
 * percentages, the same entry conditions. The wording is ours.
 *
 * Text wrapped in ** is emphasised where it is rendered - see ./guide.
 */

/**
 * The site, named once. The reference puts its own domain both in the call to
 * action and in the Even guide's heading, which is two places it could have
 * been renamed in one and not the other.
 */
export const SITE_NAME = 'Maziwatrader.com';

export const STRATEGY_CTA = `USE ${SITE_NAME} TO TRADE`;

export type TKeyTone = 'blue' | 'green' | 'red' | 'yellow';

export type TGuideBlock =
    /** A label over a bulleted list. */
    | { bullets: string[]; kind: 'bullets'; label?: string }
    /** The tinted aside, same face as the call to action but its own words. */
    | { kind: 'callout'; text: string }
    /** White cards inside the section's panel. */
    | { cards: { bullets?: string[]; tail?: string; title: string }[]; kind: 'cards' }
    | { kind: 'cta' }
    /** A bordered box with its own ENTRY POINT label. */
    | { kind: 'entry'; text: string }
    | { items: { label: string; text: string; tone: TKeyTone }[]; kind: 'key' }
    /** A heading inside a panel, over whatever follows it. */
    | { kind: 'label'; text: string }
    /** The amber aside. */
    | { kind: 'note'; text: string }
    | { items: string[]; kind: 'ordered' }
    | { kind: 'text'; text: string };

export type TGuideSection = {
    blocks: TGuideBlock[];
    /** Runs on the page itself rather than inside a panel, as prose does. */
    plain?: boolean;
    title: string;
};

export type TGuide = {
    /** The full-width call to action across the foot of the guide. */
    banner?: boolean;
    closing?: { attribution: string; lead: string; verse: string };
    heading: string;
    /** Blocks that open the guide, above the first section. */
    lead?: TGuideBlock[];
    sections: TGuideSection[];
};

/** The aside both the Odd and Even guides carry under their entry. */
const RUNS_NOTE = localize(
    'NB: AFTER 3 TO 7 RUNS MAX ON PROFITS, STOP THE BOT TO CONFIRM THE MARKET CONDITIONS AND WAIT FOR ANOTHER ENTRY TRIGGER.'
);

/**
 * The bars key, identical in both. Annotated rather than inferred: `as const`
 * would make items a readonly tuple, which is not what a block holds, while a
 * bare object widens tone to string.
 */
const BARS_KEY: TGuideBlock = {
    items: [
        { label: localize('RED'), text: localize('LEAST APPEARING DIGIT'), tone: 'red' },
        { label: localize('YELLOW'), text: localize('2ND LEAST APPEARING'), tone: 'yellow' },
        { label: localize('GREEN'), text: localize('MOST APPEARING'), tone: 'green' },
        { label: localize('BLUE'), text: localize('2ND MOST APPEARING'), tone: 'blue' },
    ],
    kind: 'key',
};

/** Shared by both of Hit and Run's prediction panels. */
const trendCard = (direction: string, colour: string, momentum: string) => ({
    bullets: [
        localize('Ensure the market is in a {{direction}}.', { direction }),
        localize('Look for {{colour}} candlesticks that are increasing in size, indicating strong {{momentum}}.', {
            colour,
            momentum,
        }),
    ],
    title: localize('1. Follow the Trend:'),
});

const digitFilterCard = (digits: string) => ({
    bullets: [
        localize(
            'Digits {{digits}} must have a percentage occurrence rate of less than 10% before entering the trade.',
            {
                digits,
            }
        ),
    ],
    title: localize('2. Digit Occurrence Filter:'),
});

export const GUIDES: Record<string, TGuide> = {
    even: {
        banner: true,
        heading: localize('Even Strategy @{{site}}', { site: SITE_NAME }),
        sections: [
            {
                blocks: [
                    {
                        bullets: [
                            localize(
                                '**BLUE & GREEN SHOULD BE ON EVEN DIGITS** - both the blue (2nd most appearing) and green (most appearing) bars must be positioned on even digits (0, 2, 4, 6, 8).'
                            ),
                            localize(
                                '**BOTH G & B BAR SHOULD HAVE %GES ABOVE 11** - both green and blue bars should have percentages above 11%.'
                            ),
                            localize(
                                '**RED & YELLOW BAR SHOULD EITHER BE ON ODD DIGITS, OR ODD/EVEN** - the red (least appearing) and yellow (2nd least appearing) bars can be on odd digits or a combination of odd/even.'
                            ),
                            localize(
                                '**RED BAR %GE: 8.6 AND BELOW** - the red bar percentage should be 8.6% or lower.'
                            ),
                            localize(
                                '**YELLOW BAR %GE: 9.5 AND BELOW** - the yellow bar percentage should be 9.5% or lower.'
                            ),
                        ],
                        kind: 'bullets',
                    },
                ],
                title: localize('CONDITIONS TO CONSIDER'),
            },
            {
                blocks: [
                    {
                        kind: 'text',
                        text: localize(
                            '**WAIT FOR TICK POINTER TO PICK THE ODD DIGIT AMONG THE LEAST APPEARING PAIR (RED & YELLOW),** if within the next **3 TICKS AN EVEN DIGIT IS PICKED, ENTER IMMEDIATELY.**'
                        ),
                    },
                    { kind: 'note', text: RUNS_NOTE },
                ],
                title: localize('ENTRYPOINT'),
            },
            { blocks: [BARS_KEY], title: localize('BARS COLOR KEY') },
        ],
    },

    'hit-and-run': {
        heading: localize('Over/Under Hit and Run Strategy & Tick Synchronization'),
        // The reference names three of its own bots here. Ours names ours -
        // pointing a reader at bots this catalogue does not have would be
        // worse than naming none.
        lead: [
            {
                kind: 'callout',
                text: localize('Recommended bots: Supatrader, Over 2 Scalper and Under 7 Scalper.'),
            },
        ],
        sections: [
            {
                blocks: [
                    {
                        kind: 'text',
                        text: localize(
                            'The Hit and Run strategy is a structured approach to trading the Over/Under market on Deriv. It leans on statistical analysis of digit occurrences to find high-probability entry points.'
                        ),
                    },
                    {
                        kind: 'text',
                        text: localize(
                            'The goal is to execute trades quickly against specific conditions, keeping exposure short while holding accuracy high.'
                        ),
                    },
                ],
                plain: true,
                title: localize('Introduction'),
            },
            {
                blocks: [
                    { kind: 'text', text: localize('The strategy focuses on two trade types:') },
                    { items: [localize('Trading Over 1'), localize('Trading Under 8')], kind: 'ordered' },
                    {
                        kind: 'text',
                        text: localize(
                            'Each has its own conditions, built on digit occurrence probabilities, trend confirmation and a validation step over a 3-tick sequence - the tick synchronization.'
                        ),
                    },
                ],
                plain: true,
                title: localize('Strategy Overview'),
            },
            {
                blocks: [
                    { kind: 'text', text: localize('**Entry Digits:** 5 or 9') },
                    {
                        kind: 'text',
                        text: localize(
                            '**Validation:** if either digit appears, check the next 3-tick sequence to determine whether it would have been a win.'
                        ),
                    },
                    {
                        kind: 'text',
                        text: localize(
                            '**Execution:** if the 3-tick sequence confirms a win, take that number as your entry and wait for the next trading confirmation before executing the trade.'
                        ),
                    },
                    { kind: 'label', text: localize('CONDITIONS:') },
                    {
                        cards: [
                            trendCard(localize('uptrend'), localize('green (bullish)'), localize('buying momentum')),
                            digitFilterCard(localize('0 and 1')),
                        ],
                        kind: 'cards',
                    },
                ],
                title: localize('Prediction: Over 1'),
            },
            {
                blocks: [
                    { kind: 'text', text: localize('**Entry Digits:** 0, 4 or 9') },
                    {
                        kind: 'text',
                        text: localize(
                            '**Validation:** if any of these digits appears, check the next 3-tick sequence to determine whether it would have been a win.'
                        ),
                    },
                    {
                        kind: 'text',
                        text: localize(
                            '**Execution:** if the 3-tick sequence confirms a win, take that number as your entry and wait for the next trading signal before executing the trade.'
                        ),
                    },
                    { kind: 'label', text: localize('CONDITIONS:') },
                    {
                        cards: [
                            trendCard(localize('downtrend'), localize('red (bearish)'), localize('selling momentum')),
                            digitFilterCard(localize('9 and 8')),
                        ],
                        kind: 'cards',
                    },
                ],
                title: localize('Prediction: Under 8'),
            },
            {
                blocks: [
                    {
                        bullets: [
                            localize('Execute the trade on the validated entry criteria.'),
                            localize(
                                'Once a trade is executed and won, exit and wait for the next valid confirmation.'
                            ),
                            localize('Increase the stake progressively, within whatever risk control you have set.'),
                        ],
                        kind: 'bullets',
                    },
                ],
                plain: true,
                title: localize('Trading Rule: Hit and Run, Increase Stake'),
            },
            {
                blocks: [
                    {
                        bullets: [
                            localize(
                                '**Stake Allocation:** use a controlled staking plan to prevent excessive losses.'
                            ),
                            localize('**Max Consecutive Trades:** limit to 3 trades per interval to minimise risk.'),
                            localize('**Stop Loss:** set a predefined stop loss to preserve capital.'),
                            localize('**Take Profit:** exit once a target profit threshold is reached.'),
                        ],
                        kind: 'bullets',
                    },
                ],
                plain: true,
                title: localize('Risk Management'),
            },
            {
                blocks: [
                    {
                        kind: 'text',
                        text: localize(
                            'The Hit and Run strategy is for quick, precise entries in Deriv’s Over/Under market.'
                        ),
                    },
                    {
                        kind: 'text',
                        text: localize(
                            'Following the digit occurrence criteria, validating entries over a 3-tick sequence and trading only on the signals that result is what keeps it disciplined.'
                        ),
                    },
                    {
                        kind: 'text',
                        text: localize('The rule is in the name: hit, and run - raising the stake deliberately.'),
                    },
                ],
                plain: true,
                title: localize('Conclusion'),
            },
        ],
    },

    odd: {
        banner: true,
        heading: localize('Odd Strategy'),
        sections: [
            {
                blocks: [
                    {
                        cards: [
                            {
                                tail: localize(
                                    'Both the green (most appearing) and blue (2nd most appearing) bars must be positioned on odd digits (1, 3, 5, 7, 9) and each should have a percentage of 11% or higher.'
                                ),
                                title: localize('1. GREEN & BLUE BARS SHOULD BOTH BE ON ODD DIGITS HAVING 11%+'),
                            },
                            {
                                bullets: [
                                    localize('RED BAR %GE: 8.6 AND BELOW'),
                                    localize('YELLOW BAR %GE: 9.5 AND BELOW'),
                                ],
                                tail: localize(
                                    'Both the red (least appearing) and yellow (2nd least appearing) bars must be positioned on even digits (0, 2, 4, 6, 8).'
                                ),
                                title: localize('2. RED & YELLOW BARS SHOULD BOTH BE ON EVEN DIGIT'),
                            },
                        ],
                        kind: 'cards',
                    },
                ],
                title: localize('CONDITIONS TO CONSIDER'),
            },
            {
                blocks: [
                    {
                        kind: 'text',
                        text: localize(
                            '**WAIT FOR THE TICK POINTER TO PICK THE LEAST APPEARING DIGIT AMONG THE R & Y,** then wait for **CONSECUTIVE 2 ODDS TO APPEAR WITHIN THE NEXT 5 TICKS,** then enter immediately.'
                        ),
                    },
                    { kind: 'note', text: RUNS_NOTE },
                ],
                title: localize('ENTRY POINT'),
            },
            { blocks: [BARS_KEY], title: localize('BARS COLOR KEY') },
        ],
    },

    'over-under': {
        closing: {
            attribution: 'Proverbs 21:5',
            lead: localize(
                'The strategy gives you direction, but discipline gives you results. Practice patiently, execute cleanly, and trust the process.'
            ),
            verse: localize(
                'The plans of the diligent lead surely to abundance, but everyone who is hasty comes only to poverty.'
            ),
        },
        heading: localize('Over/Under Strategies'),
        sections: [
            {
                blocks: [
                    {
                        bullets: [
                            localize(
                                'Digits 0, 1, 2 and 3 should each be reading below 10% and falling, with a red or yellow bar among them. That is the set-up for over 3 - if only 0, 1 and 2 are below 10%, take over 0, 1 or 2 instead.'
                            ),
                            localize(
                                'At least two of digits 4 to 9 should be at 11% or above, with the blue and green bars inside that same range.'
                            ),
                        ],
                        kind: 'bullets',
                        label: localize('CONDITIONS FOR OVER PREDICTION'),
                    },
                    {
                        kind: 'entry',
                        text: localize(
                            'Wait for the tick pointer to pick the least frequent of digits 1, 2 and 3. If the pointer then lands on any digit from 4 to 9 on the next tick, enter immediately.'
                        ),
                    },
                    { kind: 'cta' },
                ],
                title: localize('1. OVER 1,2,3 STRATEGY'),
            },
            {
                blocks: [
                    {
                        bullets: [
                            localize(
                                'Digits 9, 8, 7 and 6 should each be reading below 10% and falling, with a red or yellow bar among them. That is the set-up for under 6 - if only 9, 8 and 7 are below 10%, take under 9, 8 or 7 instead.'
                            ),
                            localize(
                                'At least two of digits 0 to 5 should be at 11% or above, with the blue and green bars inside that same range.'
                            ),
                        ],
                        kind: 'bullets',
                        label: localize('CONDITIONS FOR UNDER PREDICTION'),
                    },
                    {
                        kind: 'entry',
                        text: localize(
                            'Wait for the tick pointer to pick the least frequent of digits 8, 7 and 6. If the pointer then lands on any digit from 0 to 4 on the next tick, enter immediately.'
                        ),
                    },
                    { kind: 'cta' },
                ],
                title: localize('2. UNDER 8,7,6 STRATEGY'),
            },
        ],
    },
};
