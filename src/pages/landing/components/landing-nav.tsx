import { useEffect, useRef, useState } from 'react';
import { redirectToLogin } from '@/components/shared';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { LegacyThemeDarkIcon, LegacyThemeLightIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import './landing-nav.scss';

// Brand on the left, one action on the right, as the approved sketch has it.
// The five placeholder links this header used to carry (Tools, Markets,
// Pricing, Resources, About Us) went nowhere, and the burger menu existed
// only to hold them on a phone - both are gone. Login is the app's existing
// Deriv sign-in, not a second one.
const LandingNav = () => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const [is_scrolled, setIsScrolled] = useState(false);
    const ticking_ref = useRef(false);

    // Scroll-gated (rAF-throttled, not on every scroll event) so the nav can
    // deepen its glass once the hero has scrolled past, without adding
    // per-frame layout work.
    useEffect(() => {
        const onScroll = () => {
            if (ticking_ref.current) return;
            ticking_ref.current = true;
            requestAnimationFrame(() => {
                setIsScrolled(window.scrollY > 24);
                ticking_ref.current = false;
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <nav className={`mw-nav ${is_scrolled ? 'mw-nav--scrolled' : ''}`} aria-label={localize('Primary')}>
            <div className='mw-nav__inner'>
                <div className='mw-nav__brand'>
                    {/* The logo art carries the wordmark and tagline beneath
                        the winged mark. At header size all of that turns to
                        mush, so the frame below shows the mark alone and the
                        name is set as text beside it. */}
                    <span className='mw-nav__mark'>
                        <img src='/maziwatrader-logo-v3.png' alt='MaziwaTrader' className='mw-nav__logo' />
                    </span>
                    <span className='mw-nav__wordmark'>MAZIWATRADER</span>
                </div>

                <div className='mw-nav__actions'>
                    <button
                        type='button'
                        className='mw-nav__theme'
                        onClick={toggleTheme}
                        aria-label={localize('Change theme')}
                    >
                        {is_dark_mode_on ? (
                            <LegacyThemeDarkIcon iconSize='xs' />
                        ) : (
                            <LegacyThemeLightIcon iconSize='xs' />
                        )}
                    </button>
                    <button type='button' className='mw-nav__login' onClick={() => redirectToLogin(false)}>
                        {localize('Login')}
                    </button>
                </div>
            </div>
        </nav>
    );
};

export default LandingNav;
