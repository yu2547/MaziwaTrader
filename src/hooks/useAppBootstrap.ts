import { useEffect, useState } from 'react';
import { getBootstrapState, initTradingApi, restoreOAuthSession } from '@/app/session-bootstrap';
import { useStore } from '@/hooks/useStore';

/**
 * Runs the app's session bootstrap (see app/session-bootstrap.ts) and reports
 * when each half is done.
 *
 * Mounted by the shell, so it happens on every route rather than only on the
 * index one, and by app-root, which gates its loading screen on it. The work
 * itself is a module-level singleton, so whichever mounts first does it and
 * the other simply observes the result.
 */

// The ceiling app-root has always had on the connection: a socket that is slow
// to open must not hold the loading screen up indefinitely.
const API_INIT_TIMEOUT_MS = 2000;

const useAppBootstrap = ({ enabled = true }: { enabled?: boolean } = {}) => {
    const store = useStore();
    const [is_oauth_restore_complete, setOauthRestoreComplete] = useState(
        () => getBootstrapState().is_oauth_restore_complete
    );
    const [is_api_initialized, setApiInitialized] = useState(() => getBootstrapState().is_api_initialized);

    useEffect(() => {
        // RootStore builds itself in its own effect, so this is null on the
        // first render and the restore waits for it rather than skipping.
        if (!enabled || !store) return undefined;
        let cancelled = false;
        restoreOAuthSession(store).then(() => {
            if (!cancelled) setOauthRestoreComplete(true);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled, store]);

    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            if (!cancelled) setApiInitialized(true);
        }, API_INIT_TIMEOUT_MS);

        initTradingApi().then(() => {
            clearTimeout(timer);
            if (!cancelled) setApiInitialized(true);
        });

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [enabled]);

    return { is_api_initialized, is_oauth_restore_complete };
};

export default useAppBootstrap;
