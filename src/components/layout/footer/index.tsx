import useModalManager from '@/hooks/useModalManager';
import { getActiveTabUrl } from '@/utils/getActiveTabUrl';
import { LANGUAGES } from '@/utils/languages';
import { useTranslations } from '@deriv-com/translations';
import { DesktopLanguagesModal } from '@deriv-com/ui';
import ChangeTheme from './ChangeTheme';
import GmtClock from './GmtClock';
import LanguageSettings from './LanguageSettings';
import RiskDisclaimer from './RiskDisclaimer';
import './footer.scss';

/**
 * Deliberately minimal: the risk disclaimer, the clock, language and the
 * light/dark toggle. The status widgets, chat entry points, help/settings and
 * fullscreen control that used to sit here were removed to keep the bar
 * unobtrusive - their components are all still in this folder, so any of them
 * can be put back by importing and rendering it again.
 */
const Footer = () => {
    const { currentLang = 'EN', localize, switchLanguage } = useTranslations();
    const { hideModal, isModalOpenFor, showModal } = useModalManager();

    const openLanguageSettingModal = () => showModal('DesktopLanguagesModal');

    return (
        <footer className='app-footer'>
            <div className='app-footer__group app-footer__group--start'>
                <RiskDisclaimer />
                <GmtClock />
            </div>
            <div className='app-footer__group app-footer__group--end'>
                <ChangeTheme />
                <LanguageSettings openLanguageSettingModal={openLanguageSettingModal} />
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
