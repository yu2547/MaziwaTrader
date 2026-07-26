import { observer } from 'mobx-react-lite';
import { standalone_routes } from '@/components/shared';
import { useStore } from '@/hooks/useStore';
import {
    LabelPairedChartCandlestickCaptionRegularIcon,
    LabelPairedChartTradingviewCaptionRegularIcon,
    LabelPairedCopyCaptionRegularIcon,
    LabelPairedGrid2CaptionRegularIcon,
    LabelPairedShieldCheckCaptionRegularIcon,
} from '@deriv/quill-icons/LabelPaired';
import { LegacyReportsIcon } from '@deriv/quill-icons/Legacy';
import { Localize, localize } from '@deriv-com/translations';
import './workspace-nav-extras.scss';

const WorkspaceNavExtras = observer(() => {
    const { dashboard } = useStore();

    return (
        <div className='workspace-nav-extras' role='list'>
            <a
                className='workspace-nav-extras__item'
                href={standalone_routes.reports}
                target='_blank'
                rel='noopener noreferrer'
                role='listitem'
            >
                <LegacyReportsIcon height='24px' width='24px' fill='var(--text-general)' />
                <span className='workspace-nav-extras__label'>
                    <Localize i18n_default_text='Reports' />
                </span>
            </a>
            <a
                className='workspace-nav-extras__item'
                href={standalone_routes.trade}
                target='_blank'
                rel='noopener noreferrer'
                role='listitem'
            >
                <LabelPairedChartCandlestickCaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />
                <span className='workspace-nav-extras__label'>
                    <Localize i18n_default_text='DTrader' />
                </span>
            </a>
            <button
                type='button'
                className='workspace-nav-extras__item'
                onClick={() => dashboard.setTradingViewModalVisibility()}
                role='listitem'
            >
                <LabelPairedChartTradingviewCaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />
                <span className='workspace-nav-extras__label'>
                    <Localize i18n_default_text='TradingView' />
                </span>
            </button>
            <span
                className='workspace-nav-extras__item workspace-nav-extras__item--disabled'
                role='listitem'
                aria-disabled='true'
                title={localize('Coming soon')}
            >
                <LabelPairedGrid2CaptionRegularIcon height='24px' width='24px' fill='var(--text-less-prominent)' />
                <span className='workspace-nav-extras__label'>
                    <Localize i18n_default_text='Bulk Trader' />
                </span>
                <span className='workspace-nav-extras__badge'>
                    <Localize i18n_default_text='Coming soon' />
                </span>
            </span>
            <span
                className='workspace-nav-extras__item workspace-nav-extras__item--disabled'
                role='listitem'
                aria-disabled='true'
                title={localize('Coming soon')}
            >
                <LabelPairedShieldCheckCaptionRegularIcon height='24px' width='24px' fill='var(--text-less-prominent)' />
                <span className='workspace-nav-extras__label'>
                    <Localize i18n_default_text='Risk Calculator' />
                </span>
                <span className='workspace-nav-extras__badge'>
                    <Localize i18n_default_text='Coming soon' />
                </span>
            </span>
            <span
                className='workspace-nav-extras__item workspace-nav-extras__item--disabled'
                role='listitem'
                aria-disabled='true'
                title={localize('Coming soon')}
            >
                <LabelPairedCopyCaptionRegularIcon height='24px' width='24px' fill='var(--text-less-prominent)' />
                <span className='workspace-nav-extras__label'>
                    <Localize i18n_default_text='Copy Trading' />
                </span>
                <span className='workspace-nav-extras__badge'>
                    <Localize i18n_default_text='Coming soon' />
                </span>
            </span>
        </div>
    );
});

export default WorkspaceNavExtras;
