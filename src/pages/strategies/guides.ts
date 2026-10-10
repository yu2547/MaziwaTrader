import { localize } from '@deriv-com/translations';

/**
 * The written guideline each strategy card opens.
 *
 * Data rather than markup so a strategy that has no guide yet simply has no
 * entry here and opens onto its bots alone - adding one later is a block of
 * text, not a component.
 *
 * The rules themselves are the reference's, kept exactly: the same digits,
 * the same percentages, the same entry conditions. The wording is ours. The
 * call to action in particular is ours by name, which was the point of the
 * exercise - see STRATEGY_CTA below, which is the one place the site is
 * named, so it can never again be half-changed.
 */

export const STRATEGY_CTA = 'USE Maziwatrader.com TO TRADE';

export type TGuideSection = {
    conditions: string[];
    conditions_title: string;
    entry: string;
    title: string;
};

export type TGuide = {
    closing?: { attribution: string; lead: string; verse: string };
    heading: string;
    sections: TGuideSection[];
};

export const GUIDES: Record<string, TGuide> = {
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
                conditions: [
                    localize(
                        'Digits 0, 1, 2 and 3 should each be reading below 10% and falling, with a red or yellow bar among them. That is the set-up for over 3 - if only 0, 1 and 2 are below 10%, take over 0, 1 or 2 instead.'
                    ),
                    localize(
                        'At least two of digits 4 to 9 should be at 11% or above, with the blue and green bars inside that same range.'
                    ),
                ],
                conditions_title: localize('Conditions for over prediction'),
                entry: localize(
                    'Wait for the tick pointer to pick the least frequent of digits 1, 2 and 3. If the pointer then lands on any digit from 4 to 9 on the next tick, enter immediately.'
                ),
                title: localize('1. Over 1,2,3 strategy'),
            },
            {
                conditions: [
                    localize(
                        'Digits 9, 8, 7 and 6 should each be reading below 10% and falling, with a red or yellow bar among them. That is the set-up for under 6 - if only 9, 8 and 7 are below 10%, take under 9, 8 or 7 instead.'
                    ),
                    localize(
                        'At least two of digits 0 to 5 should be at 11% or above, with the blue and green bars inside that same range.'
                    ),
                ],
                conditions_title: localize('Conditions for under prediction'),
                entry: localize(
                    'Wait for the tick pointer to pick the least frequent of digits 8, 7 and 6. If the pointer then lands on any digit from 0 to 4 on the next tick, enter immediately.'
                ),
                title: localize('2. Under 8,7,6 strategy'),
            },
        ],
    },
};
