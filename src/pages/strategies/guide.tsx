import { Fragment } from 'react';
import { localize } from '@deriv-com/translations';
import { STRATEGY_CTA, type TGuide, type TGuideBlock } from './guides';

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

/**
 * **like this** becomes a <strong>. The guides mark up a handful of phrases
 * this way; parsing a pair of asterisks is the whole of it, and it keeps the
 * guide text readable as prose in ./guides rather than a tree of nodes.
 */
const emphasise = (text: string) =>
    text.split('**').map((part, index) =>
        // eslint-disable-next-line react/no-array-index-key
        index % 2 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>
    );

const Block = ({ block }: { block: TGuideBlock }) => {
    switch (block.kind) {
        case 'bullets':
            return (
                <>
                    {block.label && <h4 className='mw-guide__label'>{block.label}:</h4>}
                    <ul className='mw-guide__list'>
                        {block.bullets.map(bullet => (
                            <li key={bullet}>{emphasise(bullet)}</li>
                        ))}
                    </ul>
                </>
            );

        case 'cards':
            return (
                <>
                    {block.cards.map(card => (
                        <div className='mw-guide__card' key={card.title}>
                            <h4 className='mw-guide__card-title'>{card.title}</h4>
                            {card.bullets && (
                                <ul className='mw-guide__list'>
                                    {card.bullets.map(bullet => (
                                        <li key={bullet}>{bullet}</li>
                                    ))}
                                </ul>
                            )}
                            {card.tail && <p className='mw-guide__card-text'>{emphasise(card.tail)}</p>}
                        </div>
                    ))}
                </>
            );

        case 'callout':
            return <p className='mw-guide__callout'>{block.text}</p>;

        case 'cta':
            return <p className='mw-guide__cta'>{STRATEGY_CTA}</p>;

        case 'entry':
            return (
                <div className='mw-guide__entry'>
                    <h4 className='mw-guide__entry-label'>{localize('Entry point')}:</h4>
                    <p className='mw-guide__entry-text'>{emphasise(block.text)}</p>
                </div>
            );

        case 'key':
            return (
                <ul className='mw-guide__key'>
                    {block.items.map(item => (
                        <li className={`mw-guide__key-item mw-guide__key-item--${item.tone}`} key={item.label}>
                            <span className='mw-guide__key-label'>{item.label}:</span> {item.text}
                        </li>
                    ))}
                </ul>
            );

        case 'label':
            return <h4 className='mw-guide__label'>{block.text}</h4>;

        case 'note':
            return <p className='mw-guide__note'>{block.text}</p>;

        case 'ordered':
            return (
                <ol className='mw-guide__ordered'>
                    {block.items.map(item => (
                        <li key={item}>{item}</li>
                    ))}
                </ol>
            );

        case 'text':
        default:
            return <p className='mw-guide__text'>{emphasise(block.text)}</p>;
    }
};

/* eslint-disable react/no-array-index-key */
const Blocks = ({ blocks }: { blocks: TGuideBlock[] }) => (
    <>
        {blocks.map((block, index) => (
            <Block block={block} key={index} />
        ))}
    </>
);
/* eslint-enable react/no-array-index-key */

const StrategyGuide = ({ guide }: { guide: TGuide }) => (
    <article className='mw-guide'>
        <h2 className='mw-guide__heading'>{guide.heading}</h2>

        {guide.lead && (
            <div className='mw-guide__panel mw-guide__lead'>
                <Blocks blocks={guide.lead} />
            </div>
        )}

        {guide.sections.map(section => (
            <section className='mw-guide__section' key={section.title}>
                <h3 className='mw-guide__section-title'>{section.title}</h3>

                {/* Prose sections run on the page itself; the ones that hold
                    conditions sit in a panel, which is how the reference
                    separates the two. */}
                {section.plain ? (
                    <Blocks blocks={section.blocks} />
                ) : (
                    <div className='mw-guide__panel'>
                        <Blocks blocks={section.blocks} />
                    </div>
                )}
            </section>
        ))}

        {guide.banner && <p className='mw-guide__banner'>{STRATEGY_CTA}</p>}

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
