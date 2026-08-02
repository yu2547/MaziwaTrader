import useUtcClock from '@/hooks/useUtcClock';
import { useTranslations } from '@deriv-com/translations';
import { Text, Tooltip } from '@deriv-com/ui';

const GmtClock = () => {
    const { localize } = useTranslations();
    const now = useUtcClock();

    const time = now.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
    // ISO-style YYYY-MM-DD so the inline pill reads unambiguously at a
    // glance, matching the reference bottom bar rather than needing the
    // tooltip to see the date at all.
    const date = now.toLocaleDateString('sv-SE', { timeZone: 'UTC' });

    return (
        <Tooltip
            as='div'
            className='app-footer__icon app-footer__gmt-clock'
            data-testid='dt_gmt_clock'
            tooltipContent={localize('Server time: {{date}} {{time}} GMT', { date, time })}
        >
            <Text size='xs'>
                {date} {time} <span className='app-footer__gmt-clock-label'>GMT</span>
            </Text>
        </Tooltip>
    );
};

export default GmtClock;
