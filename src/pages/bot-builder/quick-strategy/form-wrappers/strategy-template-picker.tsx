import React from 'react';
import classNames from 'classnames';
import { useFormikContext } from 'formik';
import { observer } from 'mobx-react-lite';
import Input from '@/components/shared_ui/input';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { LegacyGuide1pxIcon } from '@deriv/quill-icons/Legacy';
import { localize } from '@deriv-com/translations';
import { TFormData } from '../types';
import StrategyList from './strategy-list';
import { QsSteps, TRADE_TYPES } from './trade-constants';
import './strategy-template-picker.scss';

type TStrategyTemplatePicker = {
    setCurrentStep: (current_step: QsSteps) => void;
    setSelectedTradeType: (selected_trade_type: string) => void;
};

type TSelectableChip = {
    label: string;
    onClick: () => void;
    selected: boolean;
};

/**
 * Minimal in-house replacement for @deriv-com/quill-ui's Chip.Selectable (removed
 * to drop that package's ~3.4MB CSS chunk - see H1 in the performance review).
 * Same selectable-pill behavior: a row of these, one active at a time.
 */
const SelectableChip = ({ label, onClick, selected }: TSelectableChip) => (
    <button
        type='button'
        className={classNames('strategy-template-picker__chip', {
            'strategy-template-picker__chip--selected': selected,
        })}
        aria-pressed={selected}
        onClick={onClick}
    >
        <Text as='span' size='xs'>
            {label}
        </Text>
    </button>
);

const StrategyTemplatePicker = observer(({ setCurrentStep, setSelectedTradeType }: TStrategyTemplatePicker) => {
    const { dashboard, quick_strategy } = useStore();
    const { setActiveTabTutorial, setActiveTab, setFAQSearchValue, filterTuotrialTab } = dashboard;
    const { setFormVisibility, setSelectedStrategy } = quick_strategy;
    const { setFieldValue } = useFormikContext<TFormData>();

    const [selector_chip_value, setSelectorChipValue] = React.useState(0);
    const [is_searching, setIsSearching] = React.useState(false);
    const [search_value, setSearchValue] = React.useState('');

    const handleChipSelect = (index: number) => {
        setSelectorChipValue(index);
    };

    const onSelectStrategy = (strategy: string, trade_type: string) => {
        setSelectedStrategy(strategy);
        setSelectedTradeType(trade_type);

        // Set additional data with initial values when strategy changes
        quick_strategy.setAdditionalData({
            max_payout: null,
            max_ticks: null,
            max_stake: null,
            min_stake: null,
        });

        // Update the Formik form value directly
        setFieldValue('stake', '1', true);

        setCurrentStep(QsSteps.StrategyVerified);
    };

    return (
        <div className='strategy-template-picker'>
            <div className='strategy-template-picker__panel'>
                <Input
                    type='text'
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        const value = event.target.value;
                        setSearchValue(value);
                        setIsSearching(true);
                        setFAQSearchValue(value);
                        filterTuotrialTab(value);
                    }}
                    placeholder={localize('Search')}
                    value={search_value}
                    field_className='strategy-template-picker__search-field'
                />

                <button
                    className='strategy-template-picker__icon'
                    onClick={() => {
                        setActiveTab(DBOT_TABS.TUTORIAL);
                        setActiveTabTutorial(2);
                        setFormVisibility(false);

                        // Add a small delay to ensure the tab is selected before scrolling
                        setTimeout(() => {
                            const tutorialsSection = document.getElementById('id-tutorials');
                            if (tutorialsSection) {
                                tutorialsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }
                        }, 100);
                    }}
                >
                    <LegacyGuide1pxIcon iconSize='sm' />
                </button>
            </div>
            <div className='strategy-template-picker__chips'>
                {TRADE_TYPES.map((item, index) => (
                    <SelectableChip
                        key={index}
                        onClick={() => handleChipSelect(index)}
                        selected={index == selector_chip_value}
                        label={item}
                    />
                ))}
            </div>
            <StrategyList
                selector_chip_value={selector_chip_value}
                search_value={search_value}
                is_searching={is_searching}
                onSelectStrategy={onSelectStrategy}
            />
        </div>
    );
});

export default StrategyTemplatePicker;
