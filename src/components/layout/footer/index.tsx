import ChangeTheme from './ChangeTheme';
import FullScreen from './FullScreen';
import GmtClock from './GmtClock';
import Logout from './Logout';
import NetworkStatus from './NetworkStatus';
import RiskDisclaimer from './RiskDisclaimer';
import './footer.scss';

/**
 * Two clusters, nothing between them: the risk disclaimer sits on its own at
 * the far left, and everything else is a single status group pinned right -
 * connection dot, server clock, then the three icon controls.
 *
 * The chat entry points, help/settings, account limits and endpoint widgets
 * that used to sit here are gone, as is the language selector and the Deriv
 * logo that linked out to deriv.com - its slot is the logout control now.
 * Their components are all still in this folder, so any of them can be put
 * back by importing and rendering it again.
 */
const Footer = () => (
    <footer className='app-footer'>
        <div className='app-footer__group app-footer__group--start'>
            <RiskDisclaimer />
        </div>
        <div className='app-footer__group app-footer__group--end'>
            <NetworkStatus />
            <GmtClock />
            <ChangeTheme />
            <Logout />
            <FullScreen />
        </div>
    </footer>
);

export default Footer;
