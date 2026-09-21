import MarketSceneCanvas from '@/components/market-scene/market-scene-canvas';
import { redirectToLogin, redirectToSignUp } from '@/components/shared';
import { useTranslations } from '@deriv-com/translations';
import { ArrowRightIcon, CheckCircleIcon } from './feature-icons';
import RotatingHeadline from './rotating-headline';
import './hero-section.scss';

// The hero background reuses the exact same cinematic engine as the loading
// screen (src/components/market-scene) rather than a second copy - here it
// just runs at a fixed "already alive" energy level instead of ramping with
// load progress, since there's no loading sequence on this page.
const HERO_ENERGY = 0.82;

type THeroSectionProps = {
    // Whether the loading screen has finished and the hero can be seen.
    is_revealed: boolean;
};

const HeroSection = ({ is_revealed }: THeroSectionProps) => {
    const { localize } = useTranslations();

    // What the app actually does: bots you build and run, the public market
    // feed the page itself is showing below, and synthetic indices that
    // trade around the clock.
    const checks = [localize('Smart Bots'), localize('Real Market Data'), localize('Trade Anytime')];

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

            <div className='mw-hero__inner mw-landing__shell'>
                <div className='mw-hero__logo-stage'>
                    <div className='mw-hero__logo-wrap'>
                        <div className='mw-hero__logo-glow' aria-hidden='true' />
                        <img src='/maziwatrader-logo-v3.png' alt='MaziwaTrader' className='mw-hero__logo' />
                        <div className='mw-hero__logo-sweep' aria-hidden='true' />
                    </div>
                </div>

                <span className='mw-hero__pill'>
                    <i className='mw-hero__pill-dot' aria-hidden='true' />
                    {localize('Smart Trading. A Brighter Tomorrow.')}
                </span>

                <RotatingHeadline is_active={is_revealed} />

                <button type='button' className='mw-hero__cta' onClick={() => redirectToLogin(false)}>
                    {localize('Start Trading Now')}
                    <ArrowRightIcon className='mw-hero__cta-arrow' />
                </button>

                {/* The sign-up path the page has always had - Deriv's own
                    registration - as a second, smaller button under the call
                    to action. */}
                <button type='button' className='mw-hero__signup' onClick={redirectToSignUp}>
                    {localize('Sign Up')}
                </button>

                <ul className='mw-hero__checks'>
                    {checks.map(label => (
                        <li className='mw-hero__check' key={label}>
                            <CheckCircleIcon className='mw-hero__check-icon' />
                            {label}
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
};

export default HeroSection;
