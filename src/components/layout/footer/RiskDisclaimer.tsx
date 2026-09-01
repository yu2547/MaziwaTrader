import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from '@deriv-com/translations';
import './RiskDisclaimer.scss';

const RiskDisclaimer = () => {
    const { localize } = useTranslations();
    const [is_open, setIsOpen] = useState(false);

    // Escape closes it, and the page behind stops scrolling while it is up -
    // both of which a dialog covering the screen is expected to do.
    useEffect(() => {
        if (!is_open) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        const previous_overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = previous_overflow;
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [is_open]);

    return (
        <>
            <button type='button' className='risk-disclaimer-pill' onClick={() => setIsOpen(true)}>
                {localize('Risk Disclaimer')}
            </button>

            {/* Rendered on document.body rather than in place. The footer sets
                backdrop-filter, which makes it the containing block for every
                position:fixed descendant - so `inset: 0` resolved to the footer
                bar instead of the viewport, and the dialog opened below the
                fold with its button off screen. A portal steps outside that
                entirely, and stays correct whatever the footer does next. */}
            {is_open &&
                createPortal(
                    <div className='risk-disclaimer-overlay' onClick={() => setIsOpen(false)}>
                        <div
                            className='risk-disclaimer-modal'
                            role='dialog'
                            aria-modal='true'
                            aria-label={localize('Risk Disclaimer')}
                            onClick={event => event.stopPropagation()}
                        >
                            <div className='risk-disclaimer-modal__header'>
                                <h2>{localize('Risk Disclaimer')}</h2>
                                <button
                                    type='button'
                                    className='risk-disclaimer-modal__close'
                                    onClick={() => setIsOpen(false)}
                                    aria-label={localize('Close')}
                                >
                                    ✕
                                </button>
                            </div>
                            {/* Deriv's own wording, kept as it is written: this is a
                            regulatory risk disclosure, not copy to improve on. */}
                            <p className='risk-disclaimer-modal__body'>
                                <strong>{localize('Important Risk Warning')}</strong>{' '}
                                {localize(
                                    'Deriv offers complex derivatives, such as options and contracts for difference ("CFDs"). These products may not be suitable for all clients, and trading them puts you at risk. Please make sure that you understand the following risks before trading Deriv products: a) you may lose some or all of the money you invest in the trade, b) if your trade involves currency conversion, exchange rates will affect your profit and loss. You should never trade with borrowed money or with money that you cannot afford to lose.'
                                )}
                            </p>
                            <button
                                type='button'
                                className='risk-disclaimer-modal__confirm'
                                onClick={() => setIsOpen(false)}
                            >
                                {localize('I Understand')}
                            </button>
                        </div>
                    </div>,
                    document.body
                )}
        </>
    );
};

export default RiskDisclaimer;
