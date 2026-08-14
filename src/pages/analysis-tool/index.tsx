import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from '@deriv-com/translations';
import Dcircles from './dcircles';
import './analysis-tool.scss';

type TAnalysisView = 'dcircles' | 'signals' | 'analysis_tool' | 'sl_tools' | 'all_analysis';

const VIEWS: { id: TAnalysisView; label: string }[] = [
    { id: 'dcircles', label: 'Dcircles' },
    { id: 'signals', label: 'Signals' },
    { id: 'analysis_tool', label: 'Analysis Tool' },
    { id: 'sl_tools', label: 'SL Tools' },
    { id: 'all_analysis', label: 'All Analysis' },
];

/**
 * Only Dcircles and Analysis Tool have something behind them: Dcircles reads
 * the app's live tick feed, Analysis Tool is the hosted tool this page has
 * always embedded. Signals, SL Tools and All Analysis have no data source in
 * this build, so they say so instead of rendering numbers nobody measured.
 */
const NotConnected = ({ title }: { title: string }) => {
    const { localize } = useTranslations();
    return (
        <div className='analysis-tool__empty'>
            <h2>{title}</h2>
            <p>
                {localize(
                    'This view has no data source connected in this build. It is deliberately empty rather than filled with generated figures - once a feed or service exists for it, this is where it renders.'
                )}
            </p>
        </div>
    );
};

const AnalysisTool = observer(() => {
    const [view, setView] = useState<TAnalysisView>('dcircles');
    const { localize } = useTranslations();

    return (
        <div className='analysis-tool'>
            {/* Scrolls horizontally rather than wrapping, so it stays one row
                at every width and the content below never shifts down. */}
            <nav className='analysis-tool__nav' aria-label={localize('Analysis views')}>
                {VIEWS.map(item => (
                    <button
                        key={item.id}
                        type='button'
                        className={`analysis-tool__nav-item ${view === item.id ? 'analysis-tool__nav-item--active' : ''}`}
                        aria-current={view === item.id}
                        onClick={() => setView(item.id)}
                    >
                        {localize(item.label)}
                    </button>
                ))}
            </nav>

            <div className='analysis-tool__view'>
                {view === 'dcircles' && <Dcircles />}
                {view === 'analysis_tool' && (
                    <div className='analysis-tool__iframe-container'>
                        <iframe
                            src='https://bot-analysis-tool-belex.web.app'
                            className='analysis-tool__iframe'
                            title='Bot Analysis Tool'
                            allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
                            allowFullScreen
                        />
                    </div>
                )}
                {view === 'signals' && <NotConnected title={localize('Signals')} />}
                {view === 'sl_tools' && <NotConnected title={localize('SL Tools')} />}
                {view === 'all_analysis' && <NotConnected title={localize('All Analysis')} />}
            </div>
        </div>
    );
});

export default AnalysisTool;
