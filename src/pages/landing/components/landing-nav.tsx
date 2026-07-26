import { redirectToSignUp } from '@/components/shared';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { LegacyThemeDarkIcon, LegacyThemeLightIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import './landing-nav.scss';

// Tools/Markets/Pricing/Resources/About Us don't have dedicated pages yet -
// kept as inert nav items (matching the approved reference's structure) so
// the chrome is in place; Features scrolls to the section that already
// exists on this page.
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

    return (
        <nav className='mw-nav'>
            <div className='mw-nav__brand'>
                <img src='/maziwatrader-logo-v3.png' alt='MaziwaTrader' className='mw-nav__logo' />
                <span className='mw-nav__wordmark'>MAZIWA TRADER</span>
            </div>

            <div className='mw-nav__links'>
                {NAV_LINKS.map(link => (
                    <a key={link.label} href={link.href} className='mw-nav__link'>
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
            </div>
        </nav>
    );
};

export default LandingNav;
