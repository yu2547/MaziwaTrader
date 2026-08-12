import { useNavigate, useRouteError } from 'react-router-dom';
import { Localize } from '@deriv-com/translations';
import './route-error-boundary.scss';

/**
 * Attached to each child route so a page that throws is contained to the
 * content area instead of taking the shell with it.
 *
 * Without an errorElement on the child, React Router walks up to the nearest
 * boundary - the '/' route, whose element *is* the whole Layout - and replaces
 * header, navigation and content together, leaving no way to navigate out. A
 * single unguarded call in one page could therefore strand the entire app,
 * which is exactly what happened when the Charts cleanup threw on unmount.
 */
const RouteErrorBoundary = () => {
    const error = useRouteError() as Error | undefined;
    const navigate = useNavigate();

    return (
        <div className='route-error' role='alert'>
            <h2 className='route-error__title'>
                <Localize i18n_default_text='This page ran into a problem' />
            </h2>
            <p className='route-error__body'>
                <Localize i18n_default_text='The rest of the app is still working - use the navigation above to continue.' />
            </p>
            {error?.message && <pre className='route-error__detail'>{error.message}</pre>}
            <button type='button' className='route-error__action' onClick={() => navigate('/')}>
                <Localize i18n_default_text='Back to Dashboard' />
            </button>
        </div>
    );
};

export default RouteErrorBoundary;
