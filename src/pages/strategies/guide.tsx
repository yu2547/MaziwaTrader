import { localize } from '@deriv-com/translations';
import { STRATEGY_CTA, type TGuide } from './guides';

/**
 * A strategy's written guideline.
 *
 * The reference serves this as a document inside a viewer - a page counter, a
 * download button, a read-aloud control. None of that is reproduced: there is
 * no document behind it to page through or download, and a toolbar whose
 * buttons do nothing is worse than no toolbar. This is the same content as an
 * ordinary page, which also means it reflows on a phone rather than being a
 * fixed-width sheet to pinch at.
 */
const StrategyGuide = ({ guide }: { guide: TGuide }) => (
    <article className='mw-guide'>
        <h2 className='mw-guide__heading'>{guide.heading}</h2>

        {guide.sections.map(section => (
            <section className='mw-guide__section' key={section.title}>
                <h3 className='mw-guide__section-title'>{section.title}</h3>

                <div className='mw-guide__panel'>
                    <h4 className='mw-guide__label'>{section.conditions_title}:</h4>
                    <ul className='mw-guide__list'>
                        {section.conditions.map(condition => (
                            <li key={condition}>{condition}</li>
                        ))}
                    </ul>

                    <div className='mw-guide__entry'>
                        <h4 className='mw-guide__entry-label'>{localize('Entry point')}:</h4>
                        <p className='mw-guide__entry-text'>{section.entry}</p>
                    </div>

                    <p className='mw-guide__cta'>{STRATEGY_CTA}</p>
                </div>
            </section>
        ))}

        {guide.closing && (
            <div className='mw-guide__closing'>
                <p className='mw-guide__closing-lead'>&ldquo;{guide.closing.lead}&rdquo;</p>
                <p className='mw-guide__closing-attribution'>{guide.closing.attribution}</p>
                <p className='mw-guide__closing-verse'>&ldquo;{guide.closing.verse}&rdquo;</p>
            </div>
        )}
    </article>
);

export default StrategyGuide;
