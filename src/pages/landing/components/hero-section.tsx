import MarketSceneCanvas from '@/components/market-scene/market-scene-canvas';
import { redirectToLogin, redirectToSignUp } from '@/components/shared';
import { useTranslations } from '@deriv-com/translations';
import HeroMarketCards from './hero-market-cards';
import './hero-section.scss';

// The hero background reuses the exact same cinematic engine as the loading
// screen (src/components/market-scene) rather than a second copy - here it
// just runs at a fixed "already alive" energy level instead of ramping with
// load progress, since there's no loading sequence on this page.
const HERO_ENERGY = 0.82;

const HeroSection = () => {
    const { localize } = useTranslations();

    return (
        <section className='mw-hero' id='hero'>
            <div className='mw-hero__scene'>
                <MarketSceneCanvas
                    energy={HERO_ENERGY}
                    ambientTargetSelector='.mw-hero__scene'
                    className='mw-hero__canvas'
                    variant='hero'
                />
            </div>

            <div className='mw-hero__grid'>
                <div className='mw-hero__copy'>
                    <span className='mw-hero__badge'>{localize('Free Deriv Bots, Automation & Trading Tools')}</span>
                    <h1 className='mw-hero__headline'>
                        <span>{localize('Trade Smarter.')}</span>
                        <span className='mw-hero__headline-accent'>{localize('Execute Faster.')}</span>
                    </h1>
                    <p className='mw-hero__subheading'>
                        {localize(
                            'Professional trading tools, advanced analytics, and intelligent automation built for Deriv traders.'
                        )}
                    </p>

                    <div className='mw-hero__actions'>
                        <button
                            type='button'
                            className='mw-hero__btn mw-hero__btn--primary'
                            onClick={() => redirectToLogin(false)}
                        >
                            {localize('Start Trading')}
                        </button>
                        <button type='button' className='mw-hero__btn mw-hero__btn--glass' onClick={redirectToSignUp}>
                            {localize('Sign Up')}
                        </button>
                    </div>

                    <div className='mw-hero__trust'>
                        <span>{localize('Secure & Reliable')}</span>
                        <span>{localize('Fast Execution')}</span>
                        <span>{localize('Built for Traders')}</span>
                    </div>
                </div>

                <div className='mw-hero__visual'>
                    <div className='mw-hero__logo-stage'>
                        <div className='mw-hero__logo-wrap'>
                            <div className='mw-hero__logo-glow' aria-hidden='true' />
                            <img src='/maziwatrader-logo-v3.png' alt='MaziwaTrader' className='mw-hero__logo' />
                            <div className='mw-hero__logo-sweep' aria-hidden='true' />
                        </div>
                    </div>
                    <HeroMarketCards />
                </div>
            </div>
        </section>
    );
};

export default HeroSection;
