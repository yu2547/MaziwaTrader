import React from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import useIsTNCNeeded from '@/hooks/useIsTNCNeeded';
import { useStore } from '@/hooks/useStore';
import { Localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import Button from '../shared_ui/button';
import Link from '../shared_ui/link';
import Modal from '../shared_ui/modal';
import Text from '../shared_ui/text';
import './tnc-status-update-modal.scss';

const TncStatusUpdateModal: React.FC = observer(() => {
    const { isAuthorized } = useApiBase();
    const { client } = useStore();
    const { is_cr_account } = client;
    const [is_tnc_open, setIsTncOpen] = React.useState(false);
    const { isDesktop } = useDevice();
    const is_tnc_needed = useIsTNCNeeded();

    React.useEffect(() => {
        if (is_tnc_needed) {
            setIsTncOpen(true);
        } else {
            setIsTncOpen(false);
        }
    }, [is_tnc_needed]);

    const onClick = async () => {
        if (isAuthorized) {
            await api_base.api.send({ tnc_approval: 1 });
            if (client.landing_company_shortcode) {
                client.updateTncStatus(client.landing_company_shortcode, 1);
            }
            setIsTncOpen(false);
        }
    };

    const tncLink = is_cr_account
        ? 'https://deriv.com/eu/terms-and-conditions#clients'
        : 'https://deriv.com/terms-and-conditions#clients';

    return (
        <Modal className='tnc-status-update-modal-wrapper' is_open={is_tnc_open} has_close_icon={false} width='44rem'>
            <div className='tnc-status-update-modal'>
                <Text size={isDesktop ? 'xs' : 's'} weight='bold'>
                    <Localize i18n_default_text="Updated T&C's" />
                </Text>
                <div className='tnc-status-update-modal__text-container'>
                    <Text size={isDesktop ? 'xs' : 's'}>
                        <Localize
                            i18n_default_text='Please review our updated <0>terms and conditions</0>.'
                            components={[
                                <Link className='tnc-link' key={0} size={isDesktop ? 'xs' : 's'} href={tncLink} />,
                            ]}
                        />
                    </Text>
                    <Text size={isDesktop ? 'xs' : 's'}>
                        <Localize i18n_default_text='By continuing you understand and accept the changes.' />
                    </Text>
                </div>
                <div className='tnc-status-update-modal__button'>
                    <Button primary onClick={onClick}>
                        <Localize i18n_default_text='Continue' />
                    </Button>
                </div>
            </div>
        </Modal>
    );
});

export default TncStatusUpdateModal;
