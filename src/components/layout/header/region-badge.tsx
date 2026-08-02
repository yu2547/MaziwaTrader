import { StandalonePhoneRegularIcon } from '@deriv/quill-icons/Standalone';
import { useTranslations } from '@deriv-com/translations';
import './region-badge.scss';

const SUPPORT_PHONE_NUMBER = '0712094877';

/**
 * Purely a visual region/currency label + a real support call shortcut -
 * not a live exchange-rate conversion (no verified rate feed exists for
 * this app), so it never claims to convert the account balance.
 */
const RegionBadge = () => {
    const { localize } = useTranslations();

    return (
        <div className='region-badge'>
            <span className='region-badge__currency' title={localize('Account currency')}>
                <span className='region-badge__currency-segment region-badge__currency-segment--local'>KSh</span>
                <span className='region-badge__currency-segment region-badge__currency-segment--usd'>USD</span>
            </span>
            <a
                className='region-badge__phone'
                href={`tel:${SUPPORT_PHONE_NUMBER}`}
                title={localize('Call support: {{number}}', { number: SUPPORT_PHONE_NUMBER })}
            >
                <StandalonePhoneRegularIcon height={16} width={16} />
            </a>
        </div>
    );
};

export default RegionBadge;
