import clsx from 'clsx';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useTranslations } from '@deriv-com/translations';
import { Text, Tooltip } from '@deriv-com/ui';

const ServerStatus = () => {
    const { connectionStatus } = useApiBase();
    const { localize } = useTranslations();
    const is_operational = connectionStatus === CONNECTION_STATUS.OPENED;

    return (
        <Tooltip
            as='div'
            className='app-footer__icon app-footer__server-status'
            data-testid='dt_server_status'
            tooltipContent={localize('Trading server status')}
        >
            <span
                className={clsx('app-footer__server-status-dot', {
                    'app-footer__server-status-dot--operational': is_operational,
                })}
            />
            <Text size='xs'>{is_operational ? localize('Server operational') : localize('Server degraded')}</Text>
        </Tooltip>
    );
};

export default ServerStatus;
