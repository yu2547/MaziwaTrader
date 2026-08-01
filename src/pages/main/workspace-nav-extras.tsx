import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
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
import { Localize } from '@deriv-com/translations';
import './workspace-nav-extras.scss';

const WorkspaceNavExtras = observer(() => {
    const { dashboard } = useStore();
    const navigate = useNavigate();

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
            <button
                type='button'
                className='workspace-nav-extras__item'
                onClick={() => navigate('/bulk-trader')}
                role='listitem'
            >
                <LabelPairedGrid2CaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />
                <span className='workspace-nav-extras__label'>
                    <Localize i18n_default_text='Bulk Trader' />
                </span>
            </button>
            <button
                type='button'
                className='workspace-nav-extras__item'
                onClick={() => navigate('/risk-calculator')}
                role='listitem'
            >
                <LabelPairedShieldCheckCaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />
                <span className='workspace-nav-extras__label'>
                    <Localize i18n_default_text='Risk Calculator' />
                </span>
            </button>
            <button
                type='button'
                className='workspace-nav-extras__item'
                onClick={() => navigate('/copy-trading')}
                role='listitem'
            >
                <LabelPairedCopyCaptionRegularIcon height='24px' width='24px' fill='var(--text-general)' />
                <span className='workspace-nav-extras__label'>
                    <Localize i18n_default_text='Copy Trading' />
                </span>
            </button>
        </div>
    );
});

export default WorkspaceNavExtras;
