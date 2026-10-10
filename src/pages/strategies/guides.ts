import { localize } from '@deriv-com/translations';

/**
 * The written guideline each strategy card opens.
 *
 * Data rather than markup, so a strategy with no guideline yet simply has no
 * entry here and opens onto its bots alone.
 *
 * A guide is a list of sections, and a section is a list of blocks, because
 * the two written so far are not the same shape: Over/Under is a labelled
 * list, an entry box and a small call to action inside one panel per set-up,
 * while Odd is three sections - numbered sub-cards, an entry note, a colour
 * key - under a single banner. One block list covers both, and the next
 * guideline is a block list too rather than another component.
 *
 * The rules are the reference's, kept exactly: the same digits, the same
 * percentages, the same entry conditions. The wording is ours. The call to
 * action is ours by name, and lives in STRATEGY_CTA alone so the site can
 * never be renamed in one place and not another.
 *
 * Text wrapped in ** is emphasised where it is rendered - see ./guide.
 */

export const STRATEGY_CTA = 'USE Maziwatrader.com TO TRADE';

export type TKeyTone = 'blue' | 'green' | 'red' | 'yellow';

export type TGuideBlock =
    /** A label over a bulleted list. */
    | { bullets: string[]; kind: 'bullets'; label?: string }
    /** Numbered white cards inside the section's panel. */
    | { cards: { bullets?: string[]; tail?: string; title: string }[]; kind: 'cards' }
    /** The small call to action that sits inside a panel. */
    | { kind: 'cta' }
    /** A bordered box with its own ENTRY POINT label. */
    | { kind: 'entry'; text: string }
    | { items: { label: string; text: string; tone: TKeyTone }[]; kind: 'key' }
    /** The amber aside. */
    | { kind: 'note'; text: string }
    | { kind: 'text'; text: string };

export type TGuideSection = { blocks: TGuideBlock[]; title: string };

export type TGuide = {
    /** The full-width call to action across the foot of the guide. */
    banner?: boolean;
    closing?: { attribution: string; lead: string; verse: string };
    heading: string;
    sections: TGuideSection[];
};

export const GUIDES: Record<string, TGuide> = {
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
                                title: localize('1. Green & blue bars should both be on odd digits having 11%+'),
                            },
                            {
                                bullets: [
                                    localize('Red bar %ge: 8.6 and below'),
                                    localize('Yellow bar %ge: 9.5 and below'),
                                ],
                                tail: localize(
                                    'Both the red (least appearing) and yellow (2nd least appearing) bars must be positioned on even digits (0, 2, 4, 6, 8).'
                                ),
                                title: localize('2. Red & yellow bars should both be on even digit'),
                            },
                        ],
                        kind: 'cards',
                    },
                ],
                title: localize('Conditions to consider'),
            },
            {
                blocks: [
                    {
                        kind: 'text',
                        text: localize(
                            '**Wait for the tick pointer to pick the least appearing digit among the R & Y,** then wait for **consecutive 2 odds to appear within the next 5 ticks,** then enter immediately.'
                        ),
                    },
                    {
                        kind: 'note',
                        text: localize(
                            'NB: after 3 to 7 runs max on profits, stop the bot to confirm the market conditions and wait for another entry trigger.'
                        ),
                    },
                ],
                title: localize('Entry point'),
            },
            {
                blocks: [
                    {
                        items: [
                            { label: localize('Red'), text: localize('Least appearing digit'), tone: 'red' },
                            { label: localize('Yellow'), text: localize('2nd least appearing'), tone: 'yellow' },
                            { label: localize('Green'), text: localize('Most appearing'), tone: 'green' },
                            { label: localize('Blue'), text: localize('2nd most appearing'), tone: 'blue' },
                        ],
                        kind: 'key',
                    },
                ],
                title: localize('Bars colour key'),
            },
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
                        label: localize('Conditions for over prediction'),
                    },
                    {
                        kind: 'entry',
                        text: localize(
                            'Wait for the tick pointer to pick the least frequent of digits 1, 2 and 3. If the pointer then lands on any digit from 4 to 9 on the next tick, enter immediately.'
                        ),
                    },
                    { kind: 'cta' },
                ],
                title: localize('1. Over 1,2,3 strategy'),
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
                        label: localize('Conditions for under prediction'),
                    },
                    {
                        kind: 'entry',
                        text: localize(
                            'Wait for the tick pointer to pick the least frequent of digits 8, 7 and 6. If the pointer then lands on any digit from 0 to 4 on the next tick, enter immediately.'
                        ),
                    },
                    { kind: 'cta' },
                ],
                title: localize('2. Under 8,7,6 strategy'),
            },
        ],
    },
};
