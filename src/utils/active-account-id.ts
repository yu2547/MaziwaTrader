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
export const getActiveAccountId = (client?: { loginid?: string | null } | null): string =>
    client?.loginid || api_base?.otp_account?.account_id || '';

/**
 * Currency of that same account. ClientStore.currency is empty on an OTP
 * session for the same reason loginid is, which left the run panel's money
 * amounts rendering with no currency beside them.
 */
export const getActiveCurrency = (client?: { currency?: string | null } | null): string =>
    client?.currency || api_base?.otp_account?.currency || '';
