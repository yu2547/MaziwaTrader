// Imported from the module rather than the bot-skeleton barrel on purpose:
// the barrel pulls in scratch/dbot, which reaches back into the stores, and
// the stores call this during their own field initialisation. Going through
// the barrel closed that loop and left api_base undefined at construction
// time, so building RootStore threw and every consumer of useStore() got null.
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

/**
 * The id of the account the app is actually trading on, whichever transport
 * it connected with.
 *
 * The run panel's stores key everything they keep - transactions, journal
 * entries, their session-storage caches - on ClientStore.loginid. That field
 * is only ever populated by the classic AuthWrapper flow, so on an OAuth +
 * OTP session it stays empty: every contract was filed under the key "" and
 * `get transactions()` returned nothing at all, leaving Transactions,
 * Journal and the summary tiles permanently empty however many contracts had
 * really been bought.
 *
 * This is not a stand-in for being logged in and does not claim a classic
 * session exists. It is the real account_id the OTP socket authenticated
 * against (api_base.otp_account), used purely as the key those stores were
 * already keying on. Classic sessions keep returning client.loginid exactly
 * as before - the fallback is only reached when that is empty.
 */
/**
 * The account the live connection actually authorised against. Both transports
 * populate it - classic authorize() and initOtpConnection() both write it - so
 * it is the one field that describes the session rather than a store that may
 * or may not have been filled in.
 */
const authorisedAccount = () =>
    (api_base?.account_info ?? undefined) as { currency?: string; loginid?: string } | undefined;

export const getActiveAccountId = (client?: { loginid?: string | null } | null): string =>
    (api_base?.is_otp_transport ? api_base?.otp_account?.account_id : '') ||
    authorisedAccount()?.loginid ||
    client?.loginid ||
    '';

/**
 * Currency of that same account.
 *
 * The OTP account wins over ClientStore for the same reason it does above:
 * ClientStore is not merely empty on these sessions, it can hold a leftover
 * value from a previous classic login. That is what put "Total profit/loss
 * 0.00 AUD" under a balance of 727.31 USD - the amounts were the right
 * numbers labelled with an account this session has nothing to do with.
 * Classic sessions never reach the fallback, so they are unaffected.
 */
export const getActiveCurrency = (client?: { currency?: string | null; loginid?: string | null } | null): string => {
    if (api_base?.is_otp_transport && api_base?.otp_account?.currency) return api_base.otp_account.currency;

    const account = authorisedAccount();
    if (account?.currency) return account.currency;

    // ClientStore last, and only when it is describing the account that is
    // actually connected. An unguarded fallback is how a currency belonging to
    // one account ends up labelling another one's money.
    const active_id = getActiveAccountId(client);
    if (active_id && client?.loginid && active_id !== client.loginid) return '';
    return client?.currency ?? '';
};

/**
 * How that account should be named in a message - "Demo" for a virtual
 * account, otherwise its currency. The journal writes this into every entry.
 *
 * Classic sessions get it from ClientStore's account_list, which an OAuth
 * session never populates, so those entries were left with no account label
 * at all.
 */
export const getActiveAccountLabel = (
    client?: { loginid?: string | null; currency?: string | null; account_list?: unknown } | null
): string => {
    if (api_base?.is_otp_transport && api_base?.otp_account) {
        return api_base.otp_account.account_type === 'demo' ? 'Demo' : api_base.otp_account.currency;
    }

    const account_list = (client?.account_list ?? []) as Array<{ loginid?: string; is_virtual?: boolean }>;
    const current = account_list.find(account => account?.loginid === client?.loginid);
    if (current) return current.is_virtual ? 'Demo' : getActiveCurrency(client);
    // Through getActiveCurrency, so a label can never name a currency this
    // session has nothing to do with. Empty means "not known yet", and the
    // journal deliberately drops a welcome line rather than print a guess -
    // its account reaction writes one again once the account lands.
    return getActiveCurrency(client);
};
