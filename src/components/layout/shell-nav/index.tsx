
import { startTransition } from 'react';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate } from 'react-router-dom';
import { DBOT_TABS, TAB_IDS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';

import {
    LabelPairedChartCandlestickCaptionRegularIcon,
    LabelPairedChartLineCaptionRegularIcon,
    LabelPairedChartTradingviewCaptionRegularIcon,
    LabelPairedCopyCaptionRegularIcon,
    LabelPairedGrid2CaptionRegularIcon,
    LabelPairedObjectsColumnCaptionRegularIcon,
    LabelPairedShieldCheckCaptionRegularIcon,
} from '@deriv/quill-icons/LabelPaired';

import { Localize } from '@deriv-com/translations';
import './shell-nav.scss';

// Preserve the existing navigation behavior.
// Tabs change the active dashboard tab.
// Routes navigate to a separate page.

type TNavDestination = {
    icon: React.ReactElement;
    label: React.ReactNode;
} & (
    | { kind: 'tab'; tab_index: number }
    | { kind: 'route'; path: string }
);

const ICON_PROPS = {
    height: '22px',
    width: '22px',
    fill: '#16B8F4',
} as const;

// Crisp outline icons without additional dependencies.

const NavigationIcon = ({
    kind,
}: {
    kind: 'home' | 'settings' | 'search';
}) => (
    <svg
        width='22'
        height='22'
        viewBox='0 0 24 24'
        fill='none'
        stroke='#16B8F4'
        strokeWidth='1.9'
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
        style={{ fill: 'none' }}
    >
        {kind === 'home' && (
            <>
                <path d='M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3z' />
            </>
        )}

        {kind === 'settings' && (
            <>
                <circle cx='12' cy='12' r='4' />
                <circle cx='12' cy='12' r='8.5' strokeDasharray='3 2' />
                <path d='M12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1' />
            </>
        )}

        {kind === 'search' && (
            <>
                <circle cx='10.7' cy='10.7' r='7' />
                <path d='m16 16 5 5' />
            </>
        )}
    </svg>
);

// Navigation in the exact requested order.
// Existing tab IDs and routes remain unchanged.

const NAV_DESTINATIONS: TNavDestination[] = [
    {
        kind: 'tab',
        icon: <NavigationIcon kind='home' />,
        label: <Localize i18n_default_text='Dashboard' />,
        tab_index: DBOT_TABS.DASHBOARD,
    },
    {
        kind: 'tab',
        icon: <NavigationIcon kind='settings' />,
        label: <Localize i18n_default_text='Bot Builder' />,
        tab_index: DBOT_TABS.BOT_BUILDER,
    },
    {
        kind: 'tab',
        icon: <LabelPairedObjectsColumnCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Trading Bots' />,
        tab_index: DBOT_TABS.FREE_BOTS,
    },
    {
        kind: 'route',
        icon: <LabelPairedChartLineCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Bulk Trader' />,
        path: '/bulk-trader',
    },
    {
        kind: 'route',
        icon: <LabelPairedGrid2CaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Manual' />,
        path: '/manual',
    },
    {
        kind: 'tab',
        icon: <NavigationIcon kind='search' />,
        label: <Localize i18n_default_text='Analysis Tool' />,
        tab_index: DBOT_TABS.ANALYSIS_TOOL,
    },
    {
        kind: 'route',
        icon: <LabelPairedCopyCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Copy Trading' />,
        path: '/copy-trading',
    },
    {
        kind: 'tab',
        icon: <LabelPairedChartLineCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Charts' />,
        tab_index: DBOT_TABS.CHART,
    },
    {
        kind: 'route',
        icon: <LabelPairedShieldCheckCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Risk Calculator' />,
        path: '/risk-calculator',
    },
    {
        kind: 'route',
        icon: <LabelPairedChartTradingviewCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='TradingView' />,
        path: '/tradingview',
    },
    {
        kind: 'route',
        icon: <LabelPairedChartCandlestickCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='DTrader' />,
        path: '/dtrader',
    },
];

const ShellNav = observer(() => {
    const { dashboard } = useStore() ?? {};
    const navigate = useNavigate();
    const { pathname } = useLocation();

    const is_index_route = pathname === '/';

    const goToTab = (tab_index: number) => {
        // Keep React's safe transition behavior for lazy-loaded tabs.
        startTransition(() => {
            dashboard?.setActiveTab(tab_index);
        });

        if (!is_index_route) {
            navigate('/');
            return;
        }

        const el_tab = document.getElementById(TAB_IDS[tab_index]);

        setTimeout(() => {
            el_tab?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'center',
            });
        }, 10);
    };

    return (
        <nav className='shell-nav' aria-label='Main navigation'>
            <div className='shell-nav__scroller'>
                {NAV_DESTINATIONS.map(destination => {
                    const is_tab = destination.kind === 'tab';

                    const is_active = is_tab
                        ? is_index_route &&
                          dashboard?.active_tab === destination.tab_index
                        : pathname === destination.path;

                    const key = is_tab
                        ? `tab-${destination.tab_index}`
                        : `route-${destination.path}`;

                    const handleClick = () => {
                        if (destination.kind === 'tab') {
                            goToTab(destination.tab_index);
                        } else {
                            navigate(destination.path);
                        }
                    };

                    return (
                        <button
                            key={key}
                            type='button'
                            className={`shell-nav__item${
                                is_active ? ' shell-nav__item--active' : ''
                            }`}
                            aria-current={is_active ? 'page' : undefined}
                            onClick={handleClick}
                        >
                            {destination.icon}
                            <span className='shell-nav__label'>
                                {destination.label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
});

export default ShellNav;
