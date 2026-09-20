import { useTranslations } from '@deriv-com/translations';
import { AiAnalysisIcon, BoltIcon, LiveChartsIcon, ShieldIcon } from './feature-icons';
import './highlight-badges.scss';

// The sketch's four glowing circles. Each says something about the product
// that is true of it - what it offers, not how many people use it. The
// counters that stood here before (12,842 active strategies, 2.8M trades,
// 99.97% uptime, 50+ markets) were numbers nothing in the app could back,
// and they are gone.
const HighlightBadges = () => {
    const { localize } = useTranslations();

    const badges = [
        {
            Icon: LiveChartsIcon,
            tone: 'red',
            // Synthetic indices are open around the clock, weekends included.
            value: localize('24/7'),
            label: localize('Live Markets'),
        },
        {
            Icon: AiAnalysisIcon,
            tone: 'blue',
            value: localize('AI'),
            label: localize('Smart Trading'),
        },
        {
            Icon: ShieldIcon,
            tone: 'gold',
            value: localize('Secure'),
            label: localize('Reliable Platform'),
        },
        {
            Icon: BoltIcon,
            tone: 'violet',
            value: localize('Global'),
            label: localize('Trade Anywhere'),
        },
    ];

    return (
        <section className='mw-highlights mw-landing__shell'>
            {badges.map(({ Icon, tone, value, label }) => (
                <div className='mw-highlights__item' key={label}>
                    <div className={`mw-highlights__ring mw-highlights__ring--${tone}`}>
                        <Icon className='mw-highlights__icon' />
                        <span className='mw-highlights__value'>{value}</span>
                    </div>
                    <span className='mw-highlights__label'>{label}</span>
                </div>
            ))}
        </section>
    );
};

export default HighlightBadges;
