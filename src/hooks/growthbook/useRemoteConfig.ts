import { useEffect, useState } from 'react';
import { ObjectUtils } from '@deriv-com/utils';
import initData from './remote_config.json';

// useRemoteConfig(true) is called from ~11 components across the persistent layout
// chrome (header, footer, menu-items, platform-switcher, bot-builder, etc.), each
// with its own independent useEffect and no sharing between them - mounting several
// of them at once (the normal case, since header/footer/menu are all part of the
// same layout) previously fired that many separate, identical GET requests to the
// same URL. Sharing one in-flight request across concurrent callers doesn't change
// the data-freshness behavior (each still gets a real fetch once nothing is already
// in flight), it just stops genuinely-simultaneous callers from each starting their
// own redundant network request.
let inFlightRequest: Promise<unknown> | null = null;

const remoteConfigQuery = async function () {
    if (inFlightRequest) return inFlightRequest;

    const isProductionOrStaging = process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging';
    const REMOTE_CONFIG_URL =
        process.env.REMOTE_CONFIG_URL ?? 'https://app-config-prod.firebaseio.com/remote_config/deriv-app.json';
    if (isProductionOrStaging && REMOTE_CONFIG_URL === '') {
        throw new Error('Remote Config URL is not set!');
    }

    inFlightRequest = (async () => {
        try {
            const response = await fetch(REMOTE_CONFIG_URL);
            if (!response.ok) {
                throw new Error('Remote Config Server is out of reach!');
            }
            return await response.json();
        } finally {
            inFlightRequest = null;
        }
    })();

    return inFlightRequest;
};

function useRemoteConfig(enabled = false) {
    const [data, setData] = useState(initData);

    useEffect(() => {
        enabled &&
            remoteConfigQuery()
                .then(async res => {
                    const resHash = await ObjectUtils.hashObject(res);
                    const dataHash = await ObjectUtils.hashObject(data);
                    if (resHash !== dataHash) {
                        setData(res);
                    }
                })
                .catch(error => {
                    console.error('Remote Config error: ', error);
                });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    return { data };
}

export default useRemoteConfig;
