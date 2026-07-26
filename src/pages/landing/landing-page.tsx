import AnimatedBackground from './components/animated-background';
import FeaturesSection from './components/features-section';
import HeroSection from './components/hero-section';
import LandingFooter from './components/landing-footer';
import LandingNav from './components/landing-nav';
import LiveStats from './components/live-stats';
import './landing-page.scss';

const LandingPage = () => {
    return (
        <div className='mw-landing'>
            <AnimatedBackground />
            <LandingNav />
            <div className='mw-landing__content'>
                <HeroSection />
                <LiveStats />
                <FeaturesSection />
            </div>
            <LandingFooter />
        </div>
    );
};

export default LandingPage;
