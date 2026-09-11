import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { Localize, useTranslations } from '@deriv-com/translations';
import './welcome-panel.scss';

/**
 * The welcome sheet: shown to an account on its first visit, and again when
 * one comes back after a long time away.
 *
 * "A long time" is 30 days. The point is that someone returning after months
 * has forgotten where things are, while someone who was here yesterday has
 * not - so this greets the first and stays out of the second's way.
 *
 * Per account, not per browser: switching to an account that has not seen it
 * shows it for that account, which is what "first time logging in" means when
 * one person holds several.
 *
 * The links go to the Tutorials tab, where the guide and these FAQs already
 * live (pages/tutorials/constants.ts). Nothing is duplicated here; the panel
 * is a door to content that exists.
 */

const STORAGE_KEY = 'mw_welcome_last_seen';
const LONG_ABSENCE_MS = 30 * 24 * 60 * 60 * 1000;

type TSeenMap = Record<string, number>;

const readSeen = (): TSeenMap => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? (parsed as TSeenMap) : {};
    } catch {
        // A cleared or blocked store just means nobody has seen it yet.
        return {};
    }
};

const writeSeen = (account_id: string) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readSeen(), [account_id]: Date.now() }));
    } catch {
        // Not being able to remember is not a reason to fail the render; the
        // worst case is the panel greets them again next time.
    }
};

const FAQ_TITLES = [
    'What is MaziwaTrader?',
    'Where do I find the blocks I need?',
    'How do I remove blocks from the workspace?',
];

const WelcomePanel = observer(() => {
    const { client, dashboard, oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const [is_open, setIsOpen] = useState(false);

    const account_id = oauth_session?.is_authenticated ? oauth_session.account_id : client?.loginid;

    useEffect(() => {
        if (!account_id) return;
        const last_seen = readSeen()[account_id];
        // No record at all is a first visit; an old one is a return after a
        // long absence. Both get the panel, anything recent does not.
        setIsOpen(!last_seen || Date.now() - last_seen > LONG_ABSENCE_MS);
    }, [account_id]);

    if (!is_open || !account_id) return null;

    const dismiss = () => {
        writeSeen(account_id);
        setIsOpen(false);
    };

    const openTutorials = () => {
        dashboard?.setActiveTab(DBOT_TABS.TUTORIAL);
        dismiss();
    };

    return (
        <section className='mw-welcome' role='region' aria-label={localize('Welcome')}>
            <button
                type='button'
                className='mw-welcome__close'
                onClick={dismiss}
                aria-label={localize('Close welcome message')}
            >
                ✕
            </button>

            <h2 className='mw-welcome__title'>
                <Localize i18n_default_text='Welcome to MaziwaTrader!' />
            </h2>

            <p className='mw-welcome__lead'>
                <Localize i18n_default_text="Ready to automate your trading strategy without writing any code? You've come to the right place." />
            </p>
            <p className='mw-welcome__lead'>
                <Localize i18n_default_text='Check out these guides and FAQs to learn more about building your bot:' />
            </p>

            <h3 className='mw-welcome__heading'>
                <Localize i18n_default_text='Guide' />
            </h3>
            <button type='button' className='mw-welcome__link' onClick={openTutorials}>
                <Localize i18n_default_text='MaziwaTrader - your automated trading partner' />
            </button>

            <h3 className='mw-welcome__heading'>
                <Localize i18n_default_text='FAQs' />
            </h3>
            <ul className='mw-welcome__list'>
                {FAQ_TITLES.map(title => (
                    <li key={title}>
                        <button type='button' className='mw-welcome__link' onClick={openTutorials}>
                            {title}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
});

export default WelcomePanel;
