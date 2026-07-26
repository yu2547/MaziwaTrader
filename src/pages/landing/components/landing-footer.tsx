import { useTranslations } from '@deriv-com/translations';
import './landing-footer.scss';

// Minimal by design for this milestone - GMT clock, language selector,
// social links, and "Powered by Deriv" are coming in a later pass (per the
// Milestone 2A brief) rather than being carried over from the previous
// footer implementation.
const LandingFooter = () => {
    const { localize } = useTranslations();

    return (
        <footer className='mw-footer'>
            <p className='mw-footer__copy'>
                © {new Date().getFullYear()} MaziwaTrader. {localize('All rights reserved.')}
            </p>
        </footer>
    );
};

export default LandingFooter;
