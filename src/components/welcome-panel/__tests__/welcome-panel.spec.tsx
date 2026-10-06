import { cleanup, render, screen } from '@testing-library/react';
import WelcomePanel from '../index';

/**
 * The panel's whole job is deciding when to appear, so that is what is tested:
 * a first login, a return after a long absence, and the several ways someone
 * can be here without having been away - a reload, the same day, or every day
 * for a fortnight.
 *
 * The two cases at the end are the ones that were wrong before. The record
 * used to be written only when the close button was pressed, so a reload
 * brought the panel straight back; and it stored the time of that dismissal
 * rather than of the visit, so a daily user who closed it once was greeted
 * again three days later having never left.
 */

const STORAGE_KEY = 'mw_welcome_last_seen';
const DAY = 24 * 60 * 60 * 1000;

let mock_account_id: string | undefined = 'CR111';

jest.mock('@/hooks/useStore', () => ({
    useStore: () => ({
        client: { loginid: mock_account_id },
        dashboard: { setActiveTab: jest.fn() },
        oauth_session: { is_authenticated: false },
    }),
}));

jest.mock('@deriv-com/translations', () => ({
    useTranslations: () => ({ localize: (s: string) => s }),
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <span>{i18n_default_text}</span>,
}));

jest.mock('@/constants/bot-contents', () => ({ DBOT_TABS: { TUTORIAL: 6 } }));

/**
 * Mount the panel as of `now`, and report whether it greeted the account.
 * `account_id` is always passed explicitly - a default here would quietly
 * substitute an account for the logged-out case, which passes `undefined`.
 */
const visitAt = (now: number, account_id: string | undefined) => {
    mock_account_id = account_id;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    render(<WelcomePanel />);
    const shown = screen.queryByText('Welcome to MaziwaTrader!') !== null;
    cleanup();
    return shown;
};

const readStore = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');

describe('WelcomePanel', () => {
    const t0 = Date.parse('2026-01-01T09:00:00Z');

    beforeEach(() => {
        localStorage.clear();
        mock_account_id = 'CR111';
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('greets an account that has never been here', () => {
        expect(visitAt(t0, 'CR111')).toBe(true);
    });

    it('records the visit even though the panel was never closed', () => {
        visitAt(t0, 'CR111');
        expect(readStore().CR111).toBe(t0);
    });

    it('does not greet again on a reload two minutes later', () => {
        visitAt(t0, 'CR111');
        expect(visitAt(t0 + 2 * 60 * 1000, 'CR111')).toBe(false);
    });

    it('does not greet again the next morning', () => {
        visitAt(t0, 'CR111');
        expect(visitAt(t0 + DAY, 'CR111')).toBe(false);
    });

    it('does not greet someone who has been here every day for a fortnight', () => {
        visitAt(t0, 'CR111');
        for (let d = 1; d <= 14; d += 1) visitAt(t0 + d * DAY, 'CR111');
        expect(visitAt(t0 + 15 * DAY, 'CR111')).toBe(false);
    });

    it('greets an account coming back after four days away', () => {
        visitAt(t0, 'CR111');
        expect(visitAt(t0 + 4 * DAY, 'CR111')).toBe(true);
    });

    it('greets an account coming back after three weeks away', () => {
        visitAt(t0, 'CR111');
        expect(visitAt(t0 + 21 * DAY, 'CR111')).toBe(true);
    });

    it('stays away for an absence shorter than the window', () => {
        visitAt(t0, 'CR111');
        expect(visitAt(t0 + 2 * DAY, 'CR111')).toBe(false);
    });

    it('greets a second account that has not been here, and not the first again', () => {
        visitAt(t0, 'CR111');
        expect(visitAt(t0 + 60 * 1000, 'CR222')).toBe(true);
        expect(visitAt(t0 + 90 * 1000, 'CR111')).toBe(false);
    });

    it('renders nothing, and records nothing, when nobody is logged in', () => {
        expect(visitAt(t0, undefined)).toBe(false);
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('survives a storage that throws', () => {
        const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        // Unreadable means nobody has been here, so the account is greeted.
        expect(visitAt(t0, 'CR111')).toBe(true);
        getItem.mockRestore();
        setItem.mockRestore();
    });
});
