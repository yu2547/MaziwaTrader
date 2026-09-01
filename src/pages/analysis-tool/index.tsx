import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from '@deriv-com/translations';
import Dcircles from './dcircles';
import ProAi from './pro-ai';
import Signals from './signals';
import './analysis-tool.scss';

type TAnalysisView = 'dcircles' | 'signals' | 'analysis_tool' | 'sl_tools' | 'pro_ai' | 'tick_analyser';

const VIEWS: { id: TAnalysisView; label: string }[] = [
    { id: 'dcircles', label: 'Dcircles' },
    { id: 'signals', label: 'Signals' },
    { id: 'analysis_tool', label: 'Analysis Tool' },
    { id: 'sl_tools', label: 'SL Tools' },
    { id: 'pro_ai', label: 'Pro AI' },
    { id: 'tick_analyser', label: 'Tick Analyser' },
];

/**
 * Dcircles, Signals, Pro AI and Analysis Tool have something behind them: the
 * first three read the app's live tick feed, Analysis Tool is the hosted tool
 * this page has always embedded. SL Tools and Tick Analyser have no data source
 * in this build, so they say so instead of rendering numbers nobody measured.
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
                {view === 'signals' && <Signals />}
                {view === 'sl_tools' && <NotConnected title={localize('SL Tools')} />}
                {view === 'pro_ai' && <ProAi />}
                {view === 'tick_analyser' && <NotConnected title={localize('Tick Analyser')} />}
            </div>
        </div>
    );
});

export default AnalysisTool;
