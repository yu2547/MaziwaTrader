import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { StandaloneXmarkRegularIcon } from '@deriv/quill-icons/Standalone';
import { Localize, useTranslations } from '@deriv-com/translations';
import './mobile-drawer.scss';

/**
 * The phone-width menu behind the header's hamburger.
 *
 * Everything it offers is existing functionality reached through its existing
 * entry point - the theme switch is useThemeSwitcher, the same hook the footer
 * control uses, and logout is handed in by the header so there is one logout
 * path in the app rather than a second copy of it living here.
 *
 * Navigation is deliberately absent. The workspace strip under the header is
 * always on screen and already reaches every section, so repeating it here
 * would be a second navigation to keep in sync with the first.
 */
export type TMobileDrawerProps = {
    is_open: boolean;
    onClose: () => void;
    /** The header's own logout handler - not reimplemented here. */
    onLogout: () => void;
};

const CLOCK_FORMAT = 'YYYY-MM-DD HH:mm:ss [GMT]';

const MobileDrawer = observer(({ is_open, onClose, onLogout }: TMobileDrawerProps) => {
    const { common } = useStore() ?? {};
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const { localize } = useTranslations();
    const panel_ref = useRef<HTMLDivElement | null>(null);

    // Escape closes it, matching the overlay tap and the X.
    useEffect(() => {
        if (!is_open) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [is_open, onClose]);

    // A drawer that leaves the page scrolling underneath it reads as broken on
    // a phone, where the two surfaces overlap almost entirely.
    useEffect(() => {
        if (!is_open) return undefined;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [is_open]);

    // Moving focus into the panel is what makes the X reachable by keyboard
    // and screen reader once the drawer opens.
    useEffect(() => {
        if (is_open) panel_ref.current?.focus();
    }, [is_open]);

    if (!is_open) return null;

    return (
        <div className='mw-drawer' role='presentation'>
            {/* Tapping the visible slice of page closes it, which is the
                gesture the exposed strip invites. */}
            <div className='mw-drawer__overlay' onClick={onClose} data-testid='dt_drawer_overlay' />

            <div
                className='mw-drawer__panel'
                role='dialog'
                aria-modal='true'
                aria-label={localize('Menu')}
                ref={panel_ref}
                tabIndex={-1}
            >
                <div className='mw-drawer__header'>
                    <button
                        type='button'
                        className='mw-drawer__close'
                        onClick={onClose}
                        aria-label={localize('Close menu')}
                    >
                        <StandaloneXmarkRegularIcon iconSize='sm' />
                    </button>
                    {/* Carries the app name, which the header bar gives up on
                        the narrowest phones so the balance stays on screen. */}
                    <span className='mw-drawer__title'>MaziwaTrader</span>
                </div>

                <div className='mw-drawer__body'>
                    <div className='mw-drawer__row'>
                        <span className='mw-drawer__row-label'>
                            <Localize i18n_default_text='Dark theme' />
                        </span>
                        <button
                            type='button'
                            role='switch'
                            aria-checked={is_dark_mode_on}
                            aria-label={localize('Dark theme')}
                            className={`mw-drawer__switch ${is_dark_mode_on ? 'mw-drawer__switch--on' : ''}`}
                            onClick={toggleTheme}
                        >
                            <span className='mw-drawer__switch-knob' />
                        </button>
                    </div>

                    {/* Closes on the way out - coming back to a still-open
                        drawer over a logged-out page would be wrong. */}
                    <button
                        type='button'
                        className='mw-drawer__action'
                        onClick={() => {
                            onClose();
                            onLogout();
                        }}
                    >
                        <Localize i18n_default_text='Log out' />
                    </button>
                </div>

                {/* Deriv's server time, the same source the desktop footer
                    clock reads - not the device clock. */}
                <div className='mw-drawer__footer'>
                    <span className='mw-drawer__clock'>{common?.server_time?.format(CLOCK_FORMAT) ?? ''}</span>
                    <span className='mw-drawer__clock-dot' aria-hidden='true' />
                </div>
            </div>
        </div>
    );
});

export default MobileDrawer;
