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

const DashboardHero = observer(() => {
    const { client, oauth_session, dashboard, load_modal, quick_strategy } = useStore();
    const { localize } = useTranslations();

    const is_oauth_session = oauth_session.is_authenticated;
    const login_id = is_oauth_session ? oauth_session.account_id : client.loginid;

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
        <section className='mw-hero' aria-label={localize('Dashboard hero')}>
            <div className='mw-hero__panel'>
                <div className='mw-hero__copy'>
                    <h1 className='mw-hero__greeting'>
                        <Localize i18n_default_text='Hello {{login_id}} 👋' values={{ login_id: login_id || '—' }} />
                    </h1>
                    <p className='mw-hero__subtitle'>
                        <Localize i18n_default_text='The trend is your friend — until it ends.' />
                    </p>
                    <p className='mw-hero__eyebrow'>
                        <Localize i18n_default_text='Taking you to Bot Builder...' />
                    </p>
                    <h2 className='mw-hero__section-title'>
                        <Localize i18n_default_text='Quick Actions' />
                    </h2>
                </div>

                <div className='mw-hero__actions'>
                    {actions.map(action => (
                        <button
                            type='button'
                            key={action.label}
                            className={`mw-hero-card mw-hero-card--${action.accent}`}
                            onClick={action.onClick}
                        >
                            <span className='mw-hero-card__icon'>{action.icon}</span>
                            <span className='mw-hero-card__body'>
                                <span className='mw-hero-card__title'>{action.label}</span>
                                <span className='mw-hero-card__description'>{action.description}</span>
                                <span className='mw-hero-card__footer'>
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
