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

// The sketch's horizontally scrolling card row. It holds what the app can
// actually do, not testimonials: there are no real reviews in the product to
// show, and inventing names and quotes is not on the table. The cards scroll
// with CSS scroll-snap - no carousel library, no timers, and a phone's own
// momentum scrolling.
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
            <div className='mw-landing__shell'>
                <h2 className='mw-features__title'>{localize('Everything you need to trade with an edge')}</h2>
            </div>

            <div className='mw-features__rail' tabIndex={0} role='group' aria-label={localize('Features')}>
                <div className='mw-features__track'>
                    {features.map(({ Icon, title, desc }) => (
                        <article className='mw-features__card' key={title}>
                            <span className='mw-features__icon'>
                                <Icon className='mw-features__icon-svg' />
                            </span>
                            <h3 className='mw-features__card-title'>{title}</h3>
                            <p className='mw-features__card-desc'>{desc}</p>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default FeaturesSection;
