import { LabelPairedYoutubeMdIcon } from '@deriv/quill-icons/LabelPaired';
import { useTranslations } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';

const YouTubeLink = () => {
    const { localize } = useTranslations();

    return (
        <Tooltip
            as='a'
            href='https://www.youtube.com/@mtrader_17'
            target='_blank'
            rel='noopener noreferrer'
            tooltipContent={localize('Watch us on YouTube')}
            tooltipPosition='bottom'
            className='app-header__social-icon'
        >
            <LabelPairedYoutubeMdIcon />
        </Tooltip>
    );
};

export default YouTubeLink;
