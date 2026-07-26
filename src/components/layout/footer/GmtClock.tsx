import useUtcClock from '@/hooks/useUtcClock';
import { useTranslations } from '@deriv-com/translations';
import { Text, Tooltip } from '@deriv-com/ui';

const GmtClock = () => {
    const { localize } = useTranslations();
    const now = useUtcClock();

    const time = now.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
    const date = now.toLocaleDateString('en-GB', { timeZone: 'UTC' });

    return (
        <Tooltip
            as='div'
            className='app-footer__icon app-footer__gmt-clock'
            data-testid='dt_gmt_clock'
            tooltipContent={localize('Server time: {{date}} {{time}} GMT', { date, time })}
        >
            <Text size='xs'>
                {time} <span className='app-footer__gmt-clock-label'>GMT</span>
            </Text>
        </Tooltip>
    );
};

export default GmtClock;
