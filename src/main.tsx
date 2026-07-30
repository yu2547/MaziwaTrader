import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
import { AnalyticsInitializer } from './utils/analytics';
import { registerPWA } from './utils/pwa-utils';
import { installOidcDiscoveryHostShim } from './utils/temp-oidc-discovery-host-shim';
import './styles/index.scss';

// TEMPORARY - see temp-oidc-discovery-host-shim.ts for why this exists and
// when to remove it. Must run before anything else can call
// requestOidcAuthentication().
installOidcDiscoveryHostShim();

AnalyticsInitializer();
registerPWA()
    .then(registration => {
        if (registration) {
            console.log('PWA service worker registered successfully for Chrome');
        } else {
            console.log('PWA service worker disabled for non-Chrome browser');
        }
    })
    .catch(error => {
        console.error('PWA service worker registration failed:', error);
    });

ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);
