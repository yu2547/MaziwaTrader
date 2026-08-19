import { TrackJS } from 'trackjs';

const { TRACKJS_TOKEN } = process.env;

/**
 * Custom hook to initialize TrackJS.
 * @returns {Object} An object containing the `init` function.
 */
const useTrackjs = () => {
    const isProduction = process.env.APP_ENV === 'production';
    const trackjs_version = process.env.REF_NAME ?? 'undefined';

    const initTrackJS = (loginid: string) => {
        try {
            // No token configured for this deployment, so installing only gets
            // us TrackJS complaining "missing token" on a loop in the console
            // while reporting nothing. Skip it until a token exists.
            if (!TRACKJS_TOKEN) return;

            if (!TrackJS.isInstalled()) {
                TrackJS.install({
                    application: 'standalone-deriv-bot',
                    dedupe: false,
                    enabled: isProduction,
                    token: TRACKJS_TOKEN!,
                    userId: loginid,
                    version:
                        (document.querySelector('meta[name=version]') as HTMLMetaElement)?.content ?? trackjs_version,
                });
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to initialize TrackJS', error);
        }
    };

    return { initTrackJS };
};

export default useTrackjs;
