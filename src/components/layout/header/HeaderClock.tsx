import { observer } from 'mobx-react-lite';
import moment from 'moment';
import { useStore } from '@/hooks/useStore';
import { DATE_TIME_FORMAT_WITH_OFFSET } from '@/utils/time';
import { StandaloneClockThreeRegularIcon } from '@deriv/quill-icons/Standalone';
import { Tooltip, useDevice } from '@deriv-com/ui';
import './HeaderClock.scss';

const HEADER_TIME_FORMAT = 'HH:mm:ss [GMT]';

const HeaderClock = observer(() => {
    const { isDesktop } = useDevice();
    const { common } = useStore() ?? { common: { server_time: moment() } };
    const display_time = common.server_time;

    return (
        <Tooltip
            as='div'
            className='app-header__clock'
            data-testid='dt_header_clock'
            tooltipContent={display_time.format(DATE_TIME_FORMAT_WITH_OFFSET)}
            tooltipPosition='bottom'
        >
            <StandaloneClockThreeRegularIcon fill='var(--text-prominent)' className='app-header__clock-icon' />
            {isDesktop && <span className='app-header__clock-text'>{display_time.format(HEADER_TIME_FORMAT)}</span>}
        </Tooltip>
    );
});

export default HeaderClock;
