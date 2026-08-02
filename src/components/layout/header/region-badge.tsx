import { StandalonePhoneRegularIcon } from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import './region-badge.scss';

const SUPPORT_PHONE_NUMBER = '0712094877';

/**
 * Real support call shortcut. The static KSh/USD badge that used to live
 * here was superseded by currency-selector.tsx, which shows a genuine
 * live-converted balance instead of a decorative label.
 */
const RegionBadge = () => {
    const { localize } = useTranslations();

    return (
        <a
            className='region-badge__phone'
            href={`tel:${SUPPORT_PHONE_NUMBER}`}
            title={localize('Call support: {{number}}', { number: SUPPORT_PHONE_NUMBER })}
            aria-label={localize('Call support: {{number}}', { number: SUPPORT_PHONE_NUMBER })}
        >
            <StandalonePhoneRegularIcon height={16} width={16} />
        </a>
    );
};

export default RegionBadge;
