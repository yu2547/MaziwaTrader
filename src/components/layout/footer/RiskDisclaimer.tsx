import { useState } from 'react';
import { useTranslations } from '@deriv-com/translations';
import './RiskDisclaimer.scss';

const RiskDisclaimer = () => {
    const { localize } = useTranslations();
    const [is_open, setIsOpen] = useState(false);

    return (
        <>
            <button type='button' className='risk-disclaimer-pill' onClick={() => setIsOpen(true)}>
                {localize('Risk Disclaimer')}
            </button>

            {is_open && (
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
                        <p className='risk-disclaimer-modal__body'>
                            <strong>{localize('Important risk warning: ')}</strong>
                            {localize(
                                'Trading derivative products such as options and CFDs carries a high level of risk and is not suitable for everyone. Before you start, make sure you understand what you are taking on: you could lose part or all of the money you place in a trade; if a trade involves converting between currencies, exchange rate movements will affect your result; and you should only ever trade with money you can afford to lose - never with funds you have borrowed.'
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
                </div>
            )}
        </>
    );
};

export default RiskDisclaimer;
