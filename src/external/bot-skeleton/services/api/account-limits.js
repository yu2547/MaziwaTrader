export default class AccountLimits {
    constructor(store) {
        // Kept as the store itself rather than a copy of store.ws, so the
        // socket is read when it is needed instead of when this was built -
        // see getStakePayoutLimits below.
        this.store = store;
    }

    // eslint-disable-next-line default-param-last
    getStakePayoutLimits(currency = 'USD', landing_company_shortcode = 'svg', selected_market) {
        // This used to copy store.ws once, in the constructor. An OTP session
        // builds ApiHelpers before its trading socket exists, so the copy was
        // null and stayed null for the life of the app: every call threw
        // "Cannot read properties of null (reading 'send')". The caller runs
        // inside a Blockly change listener, so that throw aborted the rest of
        // the listener chain and left the Market/Trade Type/Contract Type
        // dropdowns unpopulated - reading "Not available" - which then made
        // shouldRunBot() fail and the run exit before it ever started.
        //
        // store.ws is a live getter (app-store.ts), so reading it here gets
        // whichever socket is currently authorised. Nothing is opened, and no
        // request is sent at all when there is none yet.
        const ws = this.store?.ws;
        if (!ws?.send) return Promise.resolve({});

        return (
            ws
                .send({
                    landing_company_details: landing_company_shortcode,
                })
                .then(landing_company => {
                    const currency_config =
                        landing_company?.landing_company_details?.currency_config?.[selected_market];
                    return currency_config ? currency_config[currency] : {};
                })
                // Limits are advisory - a failure here must not take the workspace
                // down with it, which is the whole problem being fixed above.
                .catch(() => ({}))
        );
    }
}
