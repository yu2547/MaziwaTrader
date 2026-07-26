import { useEffect, useRef, useState } from 'react';
import { redirectToSignUp } from '@/components/shared';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { LegacyThemeDarkIcon, LegacyThemeLightIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import './landing-nav.scss';

// Tools/Markets/Pricing/Resources/About Us don't have dedicated pages yet -
// kept as inert nav items (matching the approved reference's structure) so
// the chrome is in place; Features scrolls to (and highlights when active)
// the section that already exists on this page.
const NAV_LINKS = [
    { label: 'Features', href: '#features' },
    { label: 'Tools', href: '#' },
    { label: 'Markets', href: '#' },
    { label: 'Pricing', href: '#' },
    { label: 'Resources', href: '#' },
    { label: 'About Us', href: '#' },
];

const LandingNav = () => {
    const { localize } = useTranslations();
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const [is_scrolled, setIsScrolled] = useState(false);
    const [is_menu_open, setIsMenuOpen] = useState(false);
    const [active_href, setActiveHref] = useState<string | null>(null);
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

    useEffect(() => {
        const features_el = document.getElementById('features');
        if (!features_el) return undefined;
        const observer = new IntersectionObserver(([entry]) => setActiveHref(entry.isIntersecting ? '#features' : null), {
            rootMargin: '-40% 0px -50% 0px',
        });
        observer.observe(features_el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!is_menu_open) return undefined;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsMenuOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [is_menu_open]);

    return (
        <nav className={`mw-nav ${is_scrolled ? 'mw-nav--scrolled' : ''}`} aria-label={localize('Primary')}>
            <div className='mw-nav__brand'>
                <img src='/maziwatrader-logo-v3.png' alt='MaziwaTrader' className='mw-nav__logo' />
                <span className='mw-nav__wordmark'>MAZIWA TRADER</span>
            </div>

            <div className='mw-nav__links'>
                {NAV_LINKS.map(link => (
                    <a
                        key={link.label}
                        href={link.href}
                        className='mw-nav__link'
                        aria-current={active_href === link.href ? 'page' : undefined}
                    >
                        {localize(link.label)}
                    </a>
                ))}
            </div>

            <div className='mw-nav__actions'>
                <button
                    type='button'
                    className='mw-nav__theme'
                    onClick={toggleTheme}
                    aria-label={localize('Change theme')}
                >
                    {is_dark_mode_on ? <LegacyThemeDarkIcon iconSize='xs' /> : <LegacyThemeLightIcon iconSize='xs' />}
                </button>
                <button type='button' className='mw-nav__signup' onClick={redirectToSignUp}>
                    {localize('Sign Up')}
                </button>
                <button
                    type='button'
                    className={`mw-nav__burger ${is_menu_open ? 'mw-nav__burger--open' : ''}`}
                    onClick={() => setIsMenuOpen(open => !open)}
                    aria-label={localize('Menu')}
                    aria-expanded={is_menu_open}
                    aria-controls='mw-nav-mobile-menu'
                >
                    <span />
                    <span />
                    <span />
                </button>
            </div>

            <div
                id='mw-nav-mobile-menu'
                className={`mw-nav__mobile ${is_menu_open ? 'mw-nav__mobile--open' : ''}`}
                aria-hidden={!is_menu_open}
            >
                {NAV_LINKS.map(link => (
                    <a
                        key={link.label}
                        href={link.href}
                        className='mw-nav__mobile-link'
                        tabIndex={is_menu_open ? 0 : -1}
                        onClick={() => setIsMenuOpen(false)}
                    >
                        {localize(link.label)}
                    </a>
                ))}
            </div>
        </nav>
    );
};

export default LandingNav;
