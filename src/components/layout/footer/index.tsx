import useRemoteConfig from '@/hooks/growthbook/useRemoteConfig';
import useModalManager from '@/hooks/useModalManager';
import { getActiveTabUrl } from '@/utils/getActiveTabUrl';
import { LANGUAGES } from '@/utils/languages';
import { useTranslations } from '@deriv-com/translations';
import { DesktopLanguagesModal } from '@deriv-com/ui';
import Livechat from '../../chat/Livechat';
import AccountLimits from './AccountLimits';
import ChangeTheme from './ChangeTheme';
import Deriv from './Deriv';
import Endpoint from './Endpoint';
import FullScreen from './FullScreen';
import GmtClock from './GmtClock';
import HelpCentre from './HelpCentre';
import LanguageSettings from './LanguageSettings';
import NetworkStatus from './NetworkStatus';
import ResponsibleTrading from './ResponsibleTrading';
import RiskDisclaimer from './RiskDisclaimer';
import ServerStatus from './ServerStatus';
import Settings from './Settings';
import WhatsApp from './WhatsApp';
import './footer.scss';

const Footer = () => {
    const { currentLang = 'EN', localize, switchLanguage } = useTranslations();
    const { hideModal, isModalOpenFor, showModal } = useModalManager();

    const openLanguageSettingModal = () => showModal('DesktopLanguagesModal');

    const { data } = useRemoteConfig(true);
    const { cs_chat_whatsapp } = data;

    return (
        <footer className='app-footer'>
            <div className='app-footer__group app-footer__group--start'>
                <RiskDisclaimer />
                <NetworkStatus />
                <ServerStatus />
                <GmtClock />
                <Endpoint />
            </div>
            <div className='app-footer__group app-footer__group--end'>
                <AccountLimits />
                <ResponsibleTrading />
                <Deriv />
                <Livechat />
                {cs_chat_whatsapp && <WhatsApp />}
                <div className='app-footer__vertical-line' />
                <ChangeTheme />
                <FullScreen />
                <LanguageSettings openLanguageSettingModal={openLanguageSettingModal} />
                <HelpCentre />
                <Settings />
            </div>

            {isModalOpenFor('DesktopLanguagesModal') && (
                <DesktopLanguagesModal
                    headerTitle={localize('Select Language')}
                    isModalOpen
                    languages={LANGUAGES}
                    onClose={hideModal}
                    onLanguageSwitch={code => {
                        switchLanguage(code);
                        hideModal();
                        window.location.replace(getActiveTabUrl());
                        window.location.reload();
                    }}
                    selectedLanguage={currentLang}
                />
            )}
        </footer>
    );
};

export default Footer;
