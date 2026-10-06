import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { Localize, useTranslations } from '@deriv-com/translations';
import './welcome-panel.scss';

/**
 * The welcome sheet: shown to an account on its first visit, and again when
 * one comes back after a few days away.
 *
 * What is stored is the time of each account's **last visit**, written on
 * every visit, and the panel is decided against the *previous* one. That is
 * the only way the "been away a while" half can be true: the question is how
 * long since they were last here, which the record has to keep answering
 * whether or not the panel showed.
 *
 * It used to store the time the panel was last dismissed, and write it only
 * when the close button was pressed, which got both halves wrong. Reading it
 * and reloading - or simply moving to another tab and back - never recorded
 * anything, so the panel returned on every single load until it was explicitly
 * closed. And because nothing moved the record forward on the days in between,
 * someone who closed it on Monday and came in every day after was greeted
 * again on Friday, having never been away at all.
 *
 * "A while" is 3 days. Short enough that someone who drops in once a week is
 * greeted each time, long enough that coming back after lunch - or the next
 * morning - does not put it straight back on screen.
 *
 * Per account: switching to an account that has not been here shows it for
 * that account, which is what "first time logging in" means when one person
 * holds several. Per browser too, localStorage being what it is - a new
 * browser or a cleared store reads as a first visit.
 *
 * The links go to the Tutorials tab, where the guide and these FAQs already
 * live (pages/tutorials/constants.ts). Nothing is duplicated here; the panel
 * is a door to content that exists.
 */

// The key predates the change of meaning above - it holds last-visit times
// now. Kept as it is on purpose: renaming it would read as "no record" for
// everyone who already has one and greet the whole user base once more.
const STORAGE_KEY = 'mw_welcome_last_seen';
const LONG_ABSENCE_MS = 3 * 24 * 60 * 60 * 1000;

type TVisitMap = Record<string, number>;

const readVisits = (): TVisitMap => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? (parsed as TVisitMap) : {};
    } catch {
        // A cleared or blocked store just means nobody has been here yet.
        return {};
    }
};

const writeVisit = (account_id: string) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readVisits(), [account_id]: Date.now() }));
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
    // Which account this mount has already ruled on. The effect both reads the
    // record and overwrites it, so letting it run twice for one account - a
    // remount, a store settling, StrictMode - would have it find its own write
    // and decide the panel away.
    const decided = useRef<string | null>(null);

    const account_id = oauth_session?.is_authenticated ? oauth_session.account_id : client?.loginid;

    useEffect(() => {
        if (!account_id || decided.current === account_id) return;
        // Once per account, and the decision has to be taken before the visit
        // is recorded - the record about to be written is "now", which would
        // answer every question with "they were just here".
        decided.current = account_id;
        const last_visit = readVisits()[account_id];
        // No record at all is a first visit; an old one is a return after a
        // long absence. Both get the panel, anything recent does not.
        setIsOpen(!last_visit || Date.now() - last_visit > LONG_ABSENCE_MS);
        // Written whether or not it showed, so the next visit is measured from
        // this one. This is also what stops a reload bringing the panel back.
        writeVisit(account_id);
    }, [account_id]);

    if (!is_open || !account_id) return null;

    // The visit is already recorded; closing it is just closing it.
    const dismiss = () => setIsOpen(false);

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
