import { useTranslations } from '@deriv-com/translations';
import {
    AiAnalysisIcon,
    BulkTraderIcon,
    LiveChartsIcon,
    ReportsIcon,
    RiskCalculatorIcon,
    TradingBotsIcon,
} from './feature-icons';
import './features-section.scss';

const FeaturesSection = () => {
    const { localize } = useTranslations();

    const features = [
        {
            Icon: AiAnalysisIcon,
            title: localize('AI Analysis'),
            desc: localize('Spot trends and signals with AI-assisted market reads.'),
        },
        {
            Icon: BulkTraderIcon,
            title: localize('Bulk Trader'),
            desc: localize('Manage and execute multiple positions in one flow.'),
        },
        {
            Icon: LiveChartsIcon,
            title: localize('Live Charts'),
            desc: localize('Professional-grade charting with real-time data.'),
        },
        {
            Icon: TradingBotsIcon,
            title: localize('Trading Bots'),
            desc: localize('Automate strategies with configurable trading bots.'),
        },
        {
            Icon: RiskCalculatorIcon,
            title: localize('Risk Calculator'),
            desc: localize('Size positions confidently with built-in risk tools.'),
        },
        {
            Icon: ReportsIcon,
            title: localize('Reports'),
            desc: localize('Track performance with clear, actionable reports.'),
        },
    ];

    return (
        <section className='mw-features' id='features'>
            <h2 className='mw-features__title'>{localize('Everything you need to trade with an edge')}</h2>
            <div className='mw-features__grid'>
                {features.map(({ Icon, title, desc }) => (
                    <div className='mw-features__card' key={title}>
                        <span className='mw-features__icon'>
                            <Icon className='mw-features__icon-svg' />
                        </span>
                        <h3 className='mw-features__card-title'>{title}</h3>
                        <p className='mw-features__card-desc'>{desc}</p>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default FeaturesSection;
