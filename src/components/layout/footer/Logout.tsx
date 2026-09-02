import { useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import { useStore } from '@/hooks/useStore';
import { useTranslations } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';

/**
 * Drawn here rather than imported, and drawn in fills rather than strokes:
 * footer.scss colours these icons with `svg > path { fill: … }`, so a
 * stroke-only glyph would come out invisible next to the theme and fullscreen
 * icons it sits beside.
 */
const SignOutMark = () => (
    <svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true' focusable='false'>
        <path d='M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3z' />
        <path d='M16.5 7.5 15.1 8.9 17.2 11H9v2h8.2l-2.1 2.1 1.4 1.4L21 12l-4.5-4.5z' />
    </svg>
);

/**
 * Logging out had no control on desktop at all - the account switcher's own
 * button is mobile-only (see account-swticher-footer.tsx) - so this is the
 * only way off the account without clearing cookies by hand.
 *
 * It uses the same pair the account switcher uses, rather than a second logout
 * path: ClientStore.logout() through useOauth2, which ends the OAuth session
 * as well as the classic one.
 */
const Logout = observer(() => {
    const { localize } = useTranslations();
    const { client, oauth_session } = useStore() ?? {};

    // Stable reference so useOauth2's own memoized oAuthLogout stays stable -
    // an inline function here would defeat it, since handleLogout is one of its
    // dependencies.
    const handleLogout = useCallback(async () => client?.logout(), [client]);
    const { oAuthLogout } = useOauth2({ handleLogout, client });

    // Nothing to log out of, nothing to show. A logout button on a logged-out
    // session is a control that cannot do its one job.
    if (!oauth_session?.is_authenticated && !client?.is_logged_in) return null;

    return (
        <Tooltip as='button' className='app-footer__icon' tooltipContent={localize('Log out')} onClick={oAuthLogout}>
            <SignOutMark />
        </Tooltip>
    );
});

export default Logout;
