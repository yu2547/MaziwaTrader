import { localize } from '@deriv-com/translations';
import { scannerIsControlling, scannerSession$ } from '@/utils/market-data/scanner-entry-session';
import { getContractTypeOptions } from '../../../shared';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.purchase = {
    init() {
        this.jsonInit(this.definition());

        // Ensure one of this type per statement-stack
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Purchase {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [['', '']],
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('This block purchases contract of a specified type.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Purchase'),
            description: localize(
                'Use this block to purchase the specific contract you want. You may add multiple Purchase blocks together with conditional blocks to define your purchase conditions. This block can only be used within the Purchase conditions block.'
            ),
            key_words: localize('buy'),
        };
    },
    onchange(event) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }

        // Scanner workspace fields can be repopulated asynchronously after
        // import, which previously reset a digit Under purchase to CALL/Rise
        // even though the preview initially validated correctly.
        const scanner = scannerSession$.getValue();
        if (scannerIsControlling() && scanner.active) {
            this.populatePurchaseList(event);
            return;
        }

        if (event.type === window.Blockly.Events.BLOCK_CREATE && event.ids?.includes(this.id)) {
            this.populatePurchaseList(event);
        } else if (event.type === window.Blockly.Events.BLOCK_CHANGE) {
            if (['TYPE_LIST', 'TRADETYPE_LIST', 'TRADETYPECAT_LIST'].includes(event.name)) {
                this.populatePurchaseList(event);
            }
        } else if (event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart && event.blockId === this.id) {
            const purchase_type_list = this.getField('PURCHASE_LIST');
            const purchase_options = purchase_type_list.menuGenerator_; // eslint-disable-line

            if (purchase_options[0][0] === '') {
                this.populatePurchaseList(event);
            }
        }
    },
    populatePurchaseList(event) {
        const trade_definition_block = this.workspace.getTradeDefinitionBlock();

        if (trade_definition_block) {
            const trade_type_block = trade_definition_block.getChildByType('trade_definition_tradetype');
            const trade_type = trade_type_block.getFieldValue('TRADETYPE_LIST');
            const contract_type_block = trade_definition_block.getChildByType('trade_definition_contracttype');
            const contract_type = contract_type_block.getFieldValue('TYPE_LIST');
            const purchase_type_list = this.getField('PURCHASE_LIST');
            const purchase_type = purchase_type_list.getValue();
            const contract_type_options = getContractTypeOptions(contract_type, trade_type);

            const scanner = scannerSession$.getValue();
            if (scannerIsControlling() && scanner.active) {
                const expected = scanner.side === 'UNDER' ? 'DIGITUNDER' : 'DIGITOVER';
                // Don't manufacture a Rise quote while category dropdowns are
                // still initializing. Restore the correct options only after
                // the trade type and contract type agree with the scan.
                if (trade_type !== 'overunder' || contract_type !== expected) return;
                const correctOptions = getContractTypeOptions(expected, 'overunder');
                if (
                    purchase_type_list.getValue() !== expected ||
                    purchase_type_list.menuGenerator_?.length !== correctOptions.length
                ) {
                    purchase_type_list.updateOptions(correctOptions, {
                        default_value: expected,
                        event_group: event?.group,
                        should_pretend_empty: true,
                    });
                    if (purchase_type_list.getValue() !== expected) {
                        purchase_type_list.setValue(expected);
                    }
                }
                return;
            }
            purchase_type_list.updateOptions(contract_type_options, {
                default_value: purchase_type,
                event_group: event?.group,
                should_pretend_empty: true,
            });
        }
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.purchase = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');

    const code = `Bot.purchase('${purchaseList}');\n`;
    return code;
};
