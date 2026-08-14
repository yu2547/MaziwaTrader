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
    (api_base?.is_otp_transport ? api_base?.otp_account?.account_id : '') || client?.loginid || '';

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
export const getActiveCurrency = (client?: { currency?: string | null } | null): string =>
    (api_base?.is_otp_transport ? api_base?.otp_account?.currency : '') || client?.currency || '';
