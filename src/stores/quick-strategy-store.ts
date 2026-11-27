import { action, makeObservable, observable, reaction } from 'mobx';
import { ApiHelpers, config as qs_config, load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { addDynamicBlockToDOM } from '@/utils/xml-dom-quick-strategy';
import { resetScannerSession, scannerIsControlling } from '@/utils/market-data/scanner-entry-session';
import { STRATEGIES } from '../pages/bot-builder/quick-strategy/config';
import { TFormData } from '../pages/bot-builder/quick-strategy/types';
import RootStore from './root-store';

export type TActiveSymbol = {
    group: string;
    text: string;
    value: string;
};

export type TLossThresholdWarningData = {
    show: boolean;
    loss_amount?: string | number;
    currency?: string;
    highlight_field?: Array<string>;
    already_shown?: boolean;
};

interface IQuickStrategyStore {
    additional_data: Record<string, unknown>;
    current_duration_min_max: {
        min: number;
        max: number;
    };
    root_store: RootStore;
    is_open: boolean;
    selected_strategy: string;
    form_data: TFormData;
    loss_threshold_warning_data: {
        show: boolean;
    };
    is_contract_dialog_open: boolean;
    is_stop_bot_dialog_open: boolean;
    is_options_loading: boolean;
    setLossThresholdWarningData: (data: TLossThresholdWarningData) => void;
    setFormVisibility: (is_open: boolean) => void;
    setSelectedStrategy: (strategy: string) => void;
    setValue: (name: string, value: string) => void;
    onSubmit: (data: TFormData) => void;
    toggleStopBotDialog: () => void;
    setCurrentDurationMinMax: (min: number, max: number) => void;
    setOptionsLoading: (is_loading: boolean) => void;
}

export default class QuickStrategyStore implements IQuickStrategyStore {
    root_store: RootStore;
    is_open = false;
    selected_strategy = 'MARTINGALE';
    form_data: TFormData = {
        symbol: qs_config().QUICK_STRATEGY.DEFAULT.symbol,
        tradetype: qs_config().QUICK_STRATEGY.DEFAULT.tradetype,
        durationtype: qs_config().QUICK_STRATEGY.DEFAULT.durationtype,
        action: 'RUN',
    };
    is_contract_dialog_open = false;
    is_stop_bot_dialog_open = false;
    is_options_loading = false;
    current_duration_min_max = {
        min: 0,
        max: 10,
    };
    loss_threshold_warning_data: TLossThresholdWarningData = {
        show: false,
    };
    additional_data = {};

    constructor(root_store: RootStore) {
        makeObservable(this, {
            additional_data: observable,
            current_duration_min_max: observable,
            form_data: observable,
            is_contract_dialog_open: observable,
            is_open: observable,
            is_stop_bot_dialog_open: observable,
            is_options_loading: observable,
            initializeLossThresholdWarningData: action,
            selected_strategy: observable,
            loss_threshold_warning_data: observable,
            onSubmit: action,
            setAdditionalData: action,
            setCurrentDurationMinMax: action,
            setFormVisibility: action,
            setSelectedStrategy: action,
            setLossThresholdWarningData: action,
            setValue: action,
            toggleStopBotDialog: action,
            setOptionsLoading: action,
        });
        this.root_store = root_store;
        reaction(
            () => this.is_open,
            () => {
                if (!this.is_open) {
                    this.selected_strategy = 'MARTINGALE';
                }
            }
        );
    }

    setAdditionalData = (data: Record<string, unknown>) => {
        this.additional_data = {
            ...this.additional_data,
            ...data,
        };
    };

    setLossThresholdWarningData = (data: TLossThresholdWarningData) => {
        this.loss_threshold_warning_data = {
            ...this.loss_threshold_warning_data,
            ...data,
        };
    };

    initializeLossThresholdWarningData = () => {
        this.loss_threshold_warning_data = {
            show: false,
            highlight_field: [],
            already_shown: false,
        };
    };

    setFormVisibility = (is_open: boolean) => {
        this.is_open = is_open;
    };

    setSelectedStrategy = (strategy: string) => {
        this.selected_strategy = strategy;
    };

    setValue = (name: string, value: string | number | boolean) => {
        this.form_data[name as keyof TFormData] = value;
    };

    setCurrentDurationMinMax = (min = 0, max = 10) => {
        this.current_duration_min_max = {
            min,
            max,
        };
    };

    onSubmit = async (data: TFormData) => {
        // Switching away from a scanner workspace is a deliberate action:
        // only clear its persistent buy lock if the existing bot is stopped.
        if (data.scanner_strategy !== true && scannerIsControlling()) {
            if (this.root_store.run_panel.is_running) {
                throw new Error('Stop the AI Scanner Bot before loading another Quick Strategy.');
            }
            resetScannerSession();
        }
        const { contracts_for } = ApiHelpers?.instance ?? {};
        if (!contracts_for) {
            if (data.scanner_strategy === true) {
                throw new Error('Deriv contract options have not loaded. Reconnect to Deriv and try Launch Bot again.');
            }
            return;
        }
        const market = await contracts_for.getMarketBySymbol(data.symbol);
        const submarket = await contracts_for.getSubmarketBySymbol(data.symbol);
        const trade_type_cat = await contracts_for.getTradeTypeCategoryByTradeType(data.tradetype);
        // A scanner-only workspace uses a separate XML strategy. This flag is
        // intentionally not part of STRATEGIES(): ordinary Quick Strategy
        // users never see or accidentally load the scanner trade template.
        const selected_strategy = data.scanner_strategy === true
            ? { name: 'ai_scanner', label: 'AI Scanner Bot' }
            : STRATEGIES()[this.selected_strategy];
        const strategy_xml = await import(/* webpackChunkName: `[request]` */ `../xml/${selected_strategy.name}.xml`);
        const strategy_dom = window.Blockly.utils.xml.textToDom(strategy_xml.default);
        if (data.scanner_strategy !== true) {
            addDynamicBlockToDOM('PREDICTION', 'last_digit_prediction', trade_type_cat, strategy_dom);
        }

        const modifyValueInputs = (key: string, value: number) => {
            const el_value_inputs = strategy_dom?.querySelectorAll(`value[strategy_value="${key}"]`);
            el_value_inputs?.forEach((el_value_input: HTMLElement) => {
                if (key.includes('boolean'))
                    if (value)
                        el_value_input.innerHTML = `<block type="logic_boolean"><field name="BOOL">TRUE</field></block>`;
                    else
                        el_value_input.innerHTML = `<block type="logic_boolean"><field name="BOOL">FALSE</field></block>`;
                else
                    el_value_input.innerHTML = `<shadow type="math_number"><field name="NUM">${value}</field></shadow>`;
            });
        };

        const modifyFieldDropdownValues = (name: string, value: string) => {
            const name_list = `${name.toUpperCase()}_LIST`;
            const el_blocks = strategy_dom?.querySelectorAll(`field[name="${name_list}"]`);
            el_blocks?.forEach((el_block: HTMLElement) => {
                el_block.innerHTML = value;
            });
        };
        const { unit, action, type, growth_rate, ...rest_data } = data;
        // This is a routing flag, not a field in the XML strategy.
        delete rest_data.scanner_strategy;
        delete rest_data.scanner_entry_digit;
        const fields_to_update = {
            market,
            submarket,
            tradetypecat: trade_type_cat,
            dalembert_unit: unit,
            oscar_unit: unit,
            type: 'both',
            ...rest_data,
            purchase: type,
            growthrate: growth_rate ? growth_rate.toString() : undefined,
        };

        Object.keys(fields_to_update).forEach(key => {
            const value = fields_to_update[key as keyof typeof fields_to_update];

            // growthrate and candleinterval are dropdown selections that happen
            // to look numeric ('0.01', '60'), so isNaN alone sends them to the
            // value inputs - which have no node to match - and the choice is
            // dropped without a word. growthrate was already excluded for that
            // reason; candleinterval is the same case. No existing caller sends
            // one, so this only changes what happens when a caller does.
            if (!isNaN(value as number) && key !== 'growthrate' && key !== 'candleinterval') {
                modifyValueInputs(key, value as number);
            } else if (typeof value === 'string') {
                modifyFieldDropdownValues(key, value);
            }
        });

        if (data.scanner_strategy === true) {
            // The bundled strategy was originally a Rise/Fall (CALL) template.
            // Updating only the trade-parameters dropdown would leave its
            // Purchase block buying CALL regardless of scan outcome.
            // Match the actual purchase choice to the selected scanner side.
            const selectedContract = data.type === 'DIGITUNDER' ? 'DIGITUNDER' : 'DIGITOVER';
            // The underlying XML was copied from a Rise/Fall Martingale bot.
            // Force all dependent dropdowns to Digits > Over/Under BEFORE
            // import. The generic categories resolver does not reliably reset
            // these when a nested, dynamic Blockly dropdown is constructed.
            const setScannerField = (blockType: string, fieldName: string, value: string) => {
                const field = strategy_dom.querySelector(
                    `block[type="${blockType}"] > field[name="${fieldName}"]`
                );
                if (!field) throw new Error(`AI Scanner XML is missing ${blockType}/${fieldName}`);
                field.textContent = value;
            };
            setScannerField('trade_definition_tradetype', 'TRADETYPECAT_LIST', 'digits');
            setScannerField('trade_definition_tradetype', 'TRADETYPE_LIST', 'overunder');
            // One specific contract type rather than 'both' means one
            // pricing path, not two redundant opposite-side proposals.
            setScannerField('trade_definition_contracttype', 'TYPE_LIST', selectedContract);
            const purchaseField = strategy_dom.querySelector(
                'block[type="before_purchase"] block[type="purchase"] field[name="PURCHASE_LIST"]'
            );
            if (!purchaseField) {
                throw new Error('AI Scanner XML has no purchase contract selector.');
            }
            purchaseField.textContent = selectedContract;

            const selectedPrediction = Number(data.last_digit_prediction);
            if (!Number.isInteger(selectedPrediction) || selectedPrediction < 0 || selectedPrediction > 9) {
                throw new Error('Invalid scanned prediction digit.');
            }
            const selectedEntryDigit = Number(data.scanner_entry_digit);
            if (!Number.isInteger(selectedEntryDigit) ||
                !(selectedContract === 'DIGITOVER'
                    ? [1, 2, 3].includes(selectedEntryDigit)
                    : [6, 7, 8].includes(selectedEntryDigit))) {
                throw new Error('The selected entry digit is not valid for this Over/Under scan.');
            }

            // This XML stores the prediction in the "Prediction" Blockly
            // variable, not in a direct number field. Configure the actual
            // initialization blocks, keeping both shadow and live value
            // synchronized for import and later manual edits.
            const setNumber = (id: string, value: number) => {
                const el = strategy_dom.querySelector(`block[id="${id}"] > field[name="NUM"]`);
                if (!el) throw new Error(`AI Scanner XML is missing numeric block ${id}`);
                el.textContent = String(value);
            };
            const setShadowNumber = (id: string, value: number) => {
                const el = strategy_dom.querySelector(`shadow[id="${id}"] > field[name="NUM"]`);
                if (el) el.textContent = String(value);
            };
            const setPair = (blockId: string, shadowId: string, value: number) => {
                setNumber(blockId, value);
                setShadowNumber(shadowId, value);
            };

            const scannerStake = Number(data.stake);
            const scannerFactor = Number(data.size);
            const scannerWins = Number(data.scanner_wins ?? 5);
            const scannerStopLoss = Number(data.loss);
            setPair('init_stake_num', 'init_stake_shadow', scannerStake);
            setPair('init_ip_num', 'init_ip_shadow', selectedPrediction);
            // Recovery predictions default to the same selected barrier:
            // otherwise the live scanner guard rejects a changed contract
            // prediction after loss. This remains editable in Free Bots.
            setPair('init_rp_num', 'init_rp_shadow', selectedPrediction);
            setPair('init_ed_num', 'init_ed_shadow', selectedEntryDigit);
            setPair('init_mt_num', 'init_mt_shadow', scannerFactor);
            setPair('init_nw_num', 'init_nw_shadow', scannerWins);
            setPair('init_sl_num', 'init_sl_shadow', scannerStopLoss);
            const useMartingale = strategy_dom.querySelector('block[id="init_um_bool"] > field[name="BOOL"]');
            if (!useMartingale) throw new Error('AI Scanner XML is missing Use Martingale setting.');
            useMartingale.textContent = data.scanner_use_martingale === false ? 'FALSE' : 'TRUE';

            // The confirmation test is <= 4 for Under, >= 4 for Over.
            const comparison = strategy_dom.querySelector('block[id="scanner_confirm_cmp"] > field[name="OP"]');
            if (!comparison) throw new Error('AI Scanner XML lacks next-tick confirmation.');
            comparison.textContent = selectedContract === 'DIGITUNDER' ? 'LTE' : 'GTE';

            // Confirm this file is the bot shared with Trading Bots → Free Bots.
            if (!strategy_dom.querySelector('block[id="scanner_arm_next_tick"]')) {
                throw new Error('AI Scanner template has no next-tick entry arming logic.');
            }
        }

        const { derivWorkspace: workspace } = Blockly;
        if (data.scanner_strategy === true && !workspace) {
            throw new Error('Bot Builder workspace is not initialized. Open Bot Builder and try again.');
        }

        // The scanner must not wait only for BLOCK_CREATE: importing an XML
        // workspace can restore an existing trade definition without emitting
        // that event. This was causing a 10-second false timeout after the bot
        // had already been loaded. Await the actual workspace import instead.
        if (action === 'RUN' && data.scanner_strategy !== true) {
            workspace
                ?.waitForBlockEvent({
                    block_type: 'trade_definition',
                    event_type: window.Blockly.Events.BLOCK_CREATE,
                    timeout: 5000,
                })
                .then(() => this.root_store.run_panel.onRunButtonClick());
        }
        this.setFormVisibility(false);
        await load({
            block_string: window.Blockly.Xml.domToText(strategy_dom),
            file_name: selected_strategy.label,
            workspace,
            from: save_types.UNSAVED,
            drop_event: null,
            strategy_id: null,
            showIncompatibleStrategyDialog: null,
        });
        if (data.scanner_strategy === true && action === 'RUN') {
            // The loaded XML is the source of truth, not a transient event.
            // If load did not create the trade definition, fail visibly and
            // leave the scanner's purchase gate closed.
            const definitions = workspace.getBlocksByType('trade_definition', false);
            if (!definitions?.length) {
                throw new Error('AI Scanner bot could not create Trade Parameters. Retry loading the strategy.');
            }
            // Validate the actual restored Blockly workspace, not just its XML.
            // A dropdown may reject the digit category and silently revert
            // to the prior Rise/Fall value during import.
            const tradeTypeBlock = workspace.getBlocksByType('trade_definition_tradetype', false)[0];
            const contractTypeBlock = workspace.getBlocksByType('trade_definition_contracttype', false)[0];
            const marketBlock = workspace.getBlocksByType('trade_definition_market', false)[0];
            const purchaseBlock = workspace.getBlocksByType('purchase', false)[0];
            const expectedContract = data.type === 'DIGITUNDER' ? 'DIGITUNDER' : 'DIGITOVER';
            const actual = {
                category: tradeTypeBlock?.getFieldValue('TRADETYPECAT_LIST'),
                tradeType: tradeTypeBlock?.getFieldValue('TRADETYPE_LIST'),
                contractType: contractTypeBlock?.getFieldValue('TYPE_LIST'),
                symbol: marketBlock?.getFieldValue('SYMBOL_LIST'),
                purchase: purchaseBlock?.getFieldValue('PURCHASE_LIST'),
            };
            if (
                actual.category !== 'digits' ||
                actual.tradeType !== 'overunder' ||
                actual.contractType !== expectedContract ||
                actual.symbol !== data.symbol ||
                actual.purchase !== expectedContract
            ) {
                throw new Error(
                    `Scanner bot mismatch: expected Digits/Over-Under/${expectedContract} ${data.symbol}, got ${JSON.stringify(actual)}. Run was blocked.`
                );
            }
            await this.root_store.run_panel.onRunButtonClick();
            if (!this.root_store.run_panel.is_running) {
                throw new Error('Trading did not start. Check your Deriv account connection, authorization and Journal, then retry.');
            }
        }
    };

    toggleStopBotDialog = (): void => {
        this.is_contract_dialog_open = !this.is_contract_dialog_open;
        this.is_stop_bot_dialog_open = !this.is_stop_bot_dialog_open;
        this.setFormVisibility(false);
    };

    setOptionsLoading = (is_loading: boolean): void => {
        this.is_options_loading = is_loading;
    };
}
