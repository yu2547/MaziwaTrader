import AnimatedBackground from './components/animated-background';
import FeaturesSection from './components/features-section';
import HeroSection from './components/hero-section';
import HighlightBadges from './components/highlight-badges';
import LandingFooter from './components/landing-footer';
import LandingNav from './components/landing-nav';
import LiveMarkets from './components/live-markets';
import './landing-page.scss';

// The order is the approved sketch's, top to bottom: header, hero (logo,
// pill, headline, supporting line, call to action, feature checks), the
// horizontally scrolling cards, the four highlights, the live market panel,
// then the brand footer. One composition for every screen - each section
// lays itself out for the width it is given rather than there being a phone
// page and a desktop page.
type TLandingPageProps = {
    // The page mounts under the loading screen, before anyone can see it.
    // This turns true once that screen has gone, so the hero's headline
    // starts cycling only when it is actually on show.
    is_revealed?: boolean;
};

const LandingPage = ({ is_revealed = true }: TLandingPageProps) => {
    return (
        <div className='mw-landing'>
            <AnimatedBackground />
            <LandingNav />
            <main className='mw-landing__content'>
                <HeroSection is_revealed={is_revealed} />
                <FeaturesSection />
                <HighlightBadges />
                <LiveMarkets />
            </main>
            <LandingFooter />
        </div>
    );
};

export default LandingPage;
