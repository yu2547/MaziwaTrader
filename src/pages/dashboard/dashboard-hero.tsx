import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    DerivLightBotBuilderIcon,
    DerivLightDerivBotIcon,
    DerivLightLocalDeviceIcon,
    DerivLightQuickStrategyIcon,
} from '@deriv/quill-icons/Illustration';
import { Localize, useTranslations } from '@deriv-com/translations';
import './dashboard-hero.scss';

type THeroAction = {
    accent: 'blue' | 'green' | 'violet' | 'gold';
    description: string;
    icon: React.ReactElement;
    label: string;
    onClick: () => void;
};

type TDayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Read off the clock of the device the person is signed in from, not the
 * server's - the greeting should match the time they can see on their own
 * screen, wherever they are.
 */
const getDayPart = (hour: number): TDayPart => {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
};

const useDayPart = (): TDayPart => {
    const [day_part, setDayPart] = useState<TDayPart>(() => getDayPart(new Date().getHours()));

    useEffect(() => {
        // Re-read every minute so a session left open overnight crosses into
        // the next part of the day instead of keeping the greeting it opened
        // with. Cheap enough to do unconditionally, and it stops with the tab.
        const interval_id = setInterval(() => setDayPart(getDayPart(new Date().getHours())), 60000);
        return () => clearInterval(interval_id);
    }, []);

    return day_part;
};

/**
 * One whole sentence per part of the day rather than a greeting glued to a
 * name, so a translator can order and punctuate it the way their language
 * needs. The account id is whoever is signed in - it comes from the session,
 * so each person sees their own.
 */
const Greeting = ({ day_part, login_id }: { day_part: TDayPart; login_id: string }) => {
    switch (day_part) {
        case 'morning':
            return <Localize i18n_default_text='Good morning, {{login_id}} 👋' values={{ login_id }} />;
        case 'afternoon':
            return <Localize i18n_default_text='Good afternoon, {{login_id}} 👋' values={{ login_id }} />;
        case 'evening':
            return <Localize i18n_default_text='Good evening, {{login_id}} 👋' values={{ login_id }} />;
        default:
            return <Localize i18n_default_text='Good night, {{login_id}} 👋' values={{ login_id }} />;
    }
};

const DashboardHero = observer(() => {
    const { client, oauth_session, dashboard, load_modal, quick_strategy } = useStore();
    const { localize } = useTranslations();

    const is_oauth_session = oauth_session.is_authenticated;
    const login_id = is_oauth_session ? oauth_session.account_id : client.loginid;
    const day_part = useDayPart();

    const openLoadModal = (tab_index: number) => {
        load_modal.toggleLoadModal();
        load_modal.setActiveTabIndex(tab_index);
        dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const actions: THeroAction[] = [
        {
            accent: 'blue',
            description: localize('Import an XML bot from your computer.'),
            icon: <DerivLightLocalDeviceIcon height='36px' width='36px' />,
            label: localize('Upload Bot'),
            onClick: () => openLoadModal(0),
        },
        {
            accent: 'green',
            description: localize('Browse ready-made trading strategies.'),
            icon: <DerivLightDerivBotIcon height='36px' width='36px' />,
            label: localize('Free Bots'),
            // The Free Bots marketplace is its own tab - this used to open the
            // load-strategy modal on its Google Drive tab instead, which is a
            // different thing entirely.
            onClick: () => dashboard.setActiveTab(DBOT_TABS.FREE_BOTS),
        },
        {
            accent: 'violet',
            description: localize('Build a custom bot with the visual editor.'),
            icon: <DerivLightBotBuilderIcon height='36px' width='36px' />,
            label: localize('Bot Editor'),
            onClick: () => dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER),
        },
        {
            accent: 'gold',
            description: localize('Start fast with a pre-built strategy template.'),
            icon: <DerivLightQuickStrategyIcon height='36px' width='36px' />,
            label: localize('Quick Strategy'),
            onClick: () => {
                dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
                quick_strategy.setFormVisibility(true);
            },
        },
    ];

    return (
        <section className='mw-dashboard-hero' aria-label={localize('Dashboard hero')}>
            <div className='mw-dashboard-hero__panel'>
                <div className='mw-dashboard-hero__copy'>
                    <h1 className='mw-dashboard-hero__greeting'>
                        <Greeting day_part={day_part} login_id={login_id || '—'} />
                    </h1>
                    <p className='mw-dashboard-hero__subtitle'>
                        <Localize i18n_default_text='The trend is your friend — until it ends.' />
                    </p>
                    <p className='mw-dashboard-hero__eyebrow'>
                        <Localize i18n_default_text='Taking you to Bot Builder...' />
                    </p>
                    <h2 className='mw-dashboard-hero__section-title'>
                        <Localize i18n_default_text='Quick Actions' />
                    </h2>
                </div>

                <div className='mw-dashboard-hero__actions'>
                    {actions.map(action => (
                        <button
                            type='button'
                            key={action.label}
                            className={`mw-dashboard-hero-card mw-dashboard-hero-card--${action.accent}`}
                            onClick={action.onClick}
                        >
                            <span className='mw-dashboard-hero-card__icon'>{action.icon}</span>
                            <span className='mw-dashboard-hero-card__body'>
                                <span className='mw-dashboard-hero-card__title'>{action.label}</span>
                                <span className='mw-dashboard-hero-card__description'>{action.description}</span>
                                <span className='mw-dashboard-hero-card__footer'>
                                    <Localize i18n_default_text='Open' />
                                    {' →'}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
});

export default DashboardHero;
