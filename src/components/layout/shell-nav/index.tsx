import { startTransition } from 'react';
import { observer } from 'mobx-react-lite';
import { useLocation, useNavigate } from 'react-router-dom';
import { standalone_routes } from '@/components/shared';
import { DBOT_TABS, TAB_IDS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    LabelPairedChartCandlestickCaptionRegularIcon,
    LabelPairedChartLineCaptionRegularIcon,
    LabelPairedChartTradingviewCaptionRegularIcon,
    LabelPairedCopyCaptionRegularIcon,
    LabelPairedGrid2CaptionRegularIcon,
    LabelPairedObjectsColumnCaptionRegularIcon,
    LabelPairedPuzzlePieceTwoCaptionRegularIcon,
    LabelPairedShieldCheckCaptionRegularIcon,
} from '@deriv/quill-icons/LabelPaired';
import { LegacyReportsIcon } from '@deriv/quill-icons/Legacy';
import { Localize } from '@deriv-com/translations';
import './shell-nav.scss';

/**
 * The application's main navigation, owned by the shell rather than by any
 * page.
 *
 * It previously lived inside pages/main (the index route), which meant every
 * `navigate()` to a sibling route - Bulk Trader, Risk Calculator, Copy
 * Trading - unmounted the navigation along with the page, leaving no way back
 * except the browser's own Back button. Mounting it in Layout, as a sibling of
 * the <Outlet/> rather than a descendant, is what makes it survive route
 * changes.
 *
 * Two kinds of destination live here, and they behave differently on purpose:
 * - Tab destinations are panels *within* the index route, so they set
 *   dashboard.active_tab (and return to '/' first if we are on another route).
 * - Route destinations are real routes, so they navigate.
 */

type TTabDestination = {
    icon: React.ReactElement;
    label: React.ReactNode;
    tab_index: number;
};

type TRouteDestination = {
    icon: React.ReactElement;
    label: React.ReactNode;
    path: string;
};

// The bar paints its own ground, so the icons carry its accent rather than
// the page's text colour. shell-nav.scss overrides the fill to white on the
// active item.
const ICON_PROPS = { height: '24px', width: '24px', fill: '#4da3ff' } as const;

const TAB_DESTINATIONS: TTabDestination[] = [
    {
        icon: <LabelPairedObjectsColumnCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Dashboard' />,
        tab_index: DBOT_TABS.DASHBOARD,
    },
    {
        icon: <LabelPairedPuzzlePieceTwoCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Bot Builder' />,
        tab_index: DBOT_TABS.BOT_BUILDER,
    },
    {
        icon: <LabelPairedChartLineCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Charts' />,
        tab_index: DBOT_TABS.CHART,
    },
    {
        icon: <LabelPairedObjectsColumnCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Trading Bots' />,
        tab_index: DBOT_TABS.FREE_BOTS,
    },
    {
        icon: <LabelPairedChartLineCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Analysis Tool' />,
        tab_index: DBOT_TABS.ANALYSIS_TOOL,
    },
];

const ROUTE_DESTINATIONS: TRouteDestination[] = [
    {
        icon: <LabelPairedGrid2CaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Manual' />,
        path: '/manual',
    },
    {
        icon: <LabelPairedGrid2CaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Bulk Trader' />,
        path: '/bulk-trader',
    },
    {
        icon: <LabelPairedShieldCheckCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Risk Calculator' />,
        path: '/risk-calculator',
    },
    {
        icon: <LabelPairedCopyCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='Copy Trading' />,
        path: '/copy-trading',
    },
    // A route rather than the draggable modal it used to open. That modal is
    // 526x595 and floats over the Bot Builder, which is fine beside a workspace
    // and no way to read a candlestick series - so from here the chart gets the
    // whole content area. The Bot Builder's own button still opens the
    // draggable one, in place, where it belongs.
    {
        icon: <LabelPairedChartTradingviewCaptionRegularIcon {...ICON_PROPS} />,
        label: <Localize i18n_default_text='TradingView' />,
        path: '/tradingview',
    },
];

const ShellNav = observer(() => {
    const { dashboard } = useStore() ?? {};
    const navigate = useNavigate();
    // useLocation, not window.location: this has to re-render when the route
    // changes so the active item stays correct.
    const { pathname } = useLocation();

    const is_index_route = pathname === '/';

    const goToTab = (tab_index: number) => {
        // Tab panels are lazy-loaded, so switching one mounts a chunk that may
        // suspend. Doing that straight out of a click handler is a synchronous
        // update, which React rejects with "A component suspended while
        // responding to synchronous input" - and the resulting throw takes the
        // content area down. startTransition marks it interruptible, which is
        // exactly what that message asks for.
        startTransition(() => {
            dashboard?.setActiveTab(tab_index);
        });
        // The tab panels only exist on the index route, so a tab pressed from
        // Bulk Trader (or any other route) has to return there first.
        if (!is_index_route) {
            navigate('/');
            return;
        }
        const el_tab = document.getElementById(TAB_IDS[tab_index]);
        setTimeout(() => {
            el_tab?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }, 10);
    };

    return (
        <nav className='shell-nav' aria-label='Main navigation'>
            <div className='shell-nav__scroller'>
                {TAB_DESTINATIONS.map(({ icon, label, tab_index }) => {
                    const is_active = is_index_route && dashboard?.active_tab === tab_index;
                    return (
                        <button
                            key={tab_index}
                            type='button'
                            className={`shell-nav__item${is_active ? ' shell-nav__item--active' : ''}`}
                            aria-current={is_active ? 'page' : undefined}
                            onClick={() => goToTab(tab_index)}
                        >
                            {icon}
                            <span className='shell-nav__label'>{label}</span>
                        </button>
                    );
                })}

                <span className='shell-nav__divider' aria-hidden='true' />

                {ROUTE_DESTINATIONS.map(({ icon, label, path }) => {
                    const is_active = pathname === path;
                    return (
                        <button
                            key={path}
                            type='button'
                            className={`shell-nav__item${is_active ? ' shell-nav__item--active' : ''}`}
                            aria-current={is_active ? 'page' : undefined}
                            onClick={() => navigate(path)}
                        >
                            {icon}
                            <span className='shell-nav__label'>{label}</span>
                        </button>
                    );
                })}

                <span className='shell-nav__divider' aria-hidden='true' />

                <a
                    className='shell-nav__item'
                    href={standalone_routes.reports}
                    target='_blank'
                    rel='noopener noreferrer'
                >
                    <LegacyReportsIcon {...ICON_PROPS} />
                    <span className='shell-nav__label'>
                        <Localize i18n_default_text='Reports' />
                    </span>
                </a>

                <a className='shell-nav__item' href={standalone_routes.trade} target='_blank' rel='noopener noreferrer'>
                    <LabelPairedChartCandlestickCaptionRegularIcon {...ICON_PROPS} />
                    <span className='shell-nav__label'>
                        <Localize i18n_default_text='DTrader' />
                    </span>
                </a>
            </div>
        </nav>
    );
});

export default ShellNav;
