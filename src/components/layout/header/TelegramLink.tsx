import { LabelPairedTelegramMdIcon } from '@deriv/quill-icons/LabelPaired';
import { useTranslations } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';

const TelegramLink = () => {
    const { localize } = useTranslations();

    return (
        <Tooltip
            as='a'
            href='https://t.me/maziwatrader'
            target='_blank'
            rel='noopener noreferrer'
            tooltipContent={localize('Join us on Telegram')}
            tooltipPosition='bottom'
            className='app-header__social-icon'
        >
            <LabelPairedTelegramMdIcon />
        </Tooltip>
    );
};

export default TelegramLink;
