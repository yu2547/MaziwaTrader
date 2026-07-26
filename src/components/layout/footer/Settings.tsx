import { standalone_routes } from '@/components/shared';
import { StandaloneGearRegularIcon } from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';

const Settings = () => {
    const { localize } = useTranslations();

    return (
        <Tooltip
            as='a'
            className='app-footer__icon'
            data-testid='dt_settings'
            href={standalone_routes.personal_details}
            tooltipContent={localize('Settings')}
        >
            <StandaloneGearRegularIcon fill='var(--text-prominent)' height='16px' width='16px' />
        </Tooltip>
    );
};

export default Settings;
