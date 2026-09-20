import { useTranslations } from '@deriv-com/translations';
import './landing-footer.scss';

// The sketch's footer: the name, the tagline that is already part of the
// brand mark, and the copyright line this footer has always carried.
const LandingFooter = () => {
    const { localize } = useTranslations();

    return (
        <footer className='mw-footer'>
            <p className='mw-footer__brand'>MAZIWATRADER</p>
            <p className='mw-footer__tagline'>{localize('Trade Smart, Stay Ahead')}</p>
            <p className='mw-footer__copy'>
                © {new Date().getFullYear()} MaziwaTrader. {localize('All rights reserved.')}
            </p>
        </footer>
    );
};

export default LandingFooter;
