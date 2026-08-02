import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { useTranslations } from '@deriv-com/translations';
import SegmentedControl from './segmented-control';

/**
 * Always-visible quick switch between the first real and first demo
 * oauth_session account - no dropdown, matching the spec's requirement that
 * this stays a direct segmented control rather than being hidden behind a
 * menu. Detailed multi-account choice (if a login has several real accounts
 * in different currencies) still lives in the profile dropdown.
 */
const AccountTypeSelector = observer(() => {
    const { oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();

    if (!oauth_session?.is_authenticated) return null;

    const accounts = oauth_session.accounts ?? [];
    if (accounts.length === 0) return null;

    const current_type = oauth_session.account_type === 'demo' ? 'demo' : 'real';

    const handleChange = (value: string) => {
        if (value === current_type) return;
        const target = accounts.find(account => account.account_type === value);
        if (target) oauth_session.selectAccount(target.account_id);
    };

    const options = [
        { value: 'real', label: localize('Real') },
        { value: 'demo', label: localize('Demo') },
    ];

    return (
        <SegmentedControl
            id='account-type'
            ariaLabel={localize('Account type')}
            options={options}
            value={current_type}
            onChange={handleChange}
        />
    );
});

export default AccountTypeSelector;
