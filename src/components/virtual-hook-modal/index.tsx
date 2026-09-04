import { useEffect, useState } from 'react';
import {
    getVirtualHookToken,
    readVirtualHookSettings,
    setVirtualHookToken,
    TVirtualHookSettings,
    VH_SETTINGS_EVENT,
    VIRTUAL_HOOK_DEFAULTS,
    writeVirtualHookSettings,
} from '@/utils/virtual-hook';
import { Localize, useTranslations } from '@deriv-com/translations';
import './virtual-hook-modal.scss';

/**
 * Settings behind the block's "VH Settings" button.
 *
 * Opened by a window event the block fires rather than by a store flag, so
 * nothing has to be threaded from Blockly through DBotStore into React just to
 * show a dialog - the block already knows its own id, and that is all this
 * needs to read and write the right block's settings.
 *
 * The three numeric settings are written back onto the block, so they travel
 * with the strategy. The token is not: it is a Deriv API token, and bot XML is
 * exported and shared. See utils/virtual-hook.ts.
 */
type TBlockLike = { data?: string | null; setFieldValue?: (value: string, name: string) => void };

const getBlock = (block_id: string): TBlockLike | null => {
    const workspace = (window as any).Blockly?.derivWorkspace;
    return workspace?.getBlockById?.(block_id) ?? null;
};

const VirtualHookModal = () => {
    const { localize } = useTranslations();
    const [block_id, setBlockId] = useState<string | null>(null);
    const [settings, setSettings] = useState<TVirtualHookSettings>(VIRTUAL_HOOK_DEFAULTS);
    const [token, setToken] = useState('');

    useEffect(() => {
        const onOpen = (event: Event) => {
            const id = (event as CustomEvent<{ block_id: string }>).detail?.block_id;
            if (!id) return;
            const block = getBlock(id);
            setSettings(readVirtualHookSettings(block));
            setToken(getVirtualHookToken());
            setBlockId(id);
        };
        window.addEventListener(VH_SETTINGS_EVENT, onOpen);
        return () => window.removeEventListener(VH_SETTINGS_EVENT, onOpen);
    }, []);

    useEffect(() => {
        if (!block_id) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setBlockId(null);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [block_id]);

    if (!block_id) return null;

    const close = () => setBlockId(null);

    const save = () => {
        const block = getBlock(block_id);
        // block.data is the whole record now. The block face used to carry a
        // matching checkbox and this kept the two in step; that row is gone,
        // and setFieldValue on a field that no longer exists throws.
        writeVirtualHookSettings(block, settings);
        setVirtualHookToken(token.trim());
        close();
    };

    const numberField = (
        label: React.ReactNode,
        value: number,
        onChange: (value: number) => void,
        step: string,
        min: string
    ) => (
        <label className='mw-vh__row'>
            <span className='mw-vh__label'>{label}</span>
            <input
                className='mw-vh__input'
                type='number'
                inputMode='decimal'
                step={step}
                min={min}
                value={value}
                onChange={event => onChange(Number(event.target.value))}
            />
        </label>
    );

    return (
        <div className='mw-vh' role='presentation'>
            <div className='mw-vh__overlay' onClick={close} data-testid='dt_vh_overlay' />
            <div
                className='mw-vh__dialog'
                role='dialog'
                aria-modal='true'
                aria-label={localize('Virtual Hook settings')}
            >
                <div className='mw-vh__header'>
                    <h2 className='mw-vh__title'>
                        <Localize i18n_default_text='Virtual Hook settings' />
                    </h2>
                    <button type='button' className='mw-vh__close' onClick={close} aria-label={localize('Close')}>
                        ✕
                    </button>
                </div>

                <div className='mw-vh__body'>
                    <label className='mw-vh__row'>
                        <span className='mw-vh__label'>
                            <Localize i18n_default_text='Enable Virtual Hook' />
                        </span>
                        <input
                            className='mw-vh__checkbox'
                            type='checkbox'
                            checked={settings.enabled}
                            onChange={event => setSettings({ ...settings, enabled: event.target.checked })}
                        />
                    </label>

                    {numberField(
                        <Localize i18n_default_text='Max virtual loss steps' />,
                        settings.max_virtual_loss_steps,
                        value => setSettings({ ...settings, max_virtual_loss_steps: value }),
                        '1',
                        '1'
                    )}

                    {numberField(
                        <Localize i18n_default_text='Required real wins before re-enable' />,
                        settings.required_real_wins,
                        value => setSettings({ ...settings, required_real_wins: value }),
                        '1',
                        '1'
                    )}

                    {numberField(
                        <Localize i18n_default_text='Virtual stake' />,
                        settings.virtual_stake,
                        value => setSettings({ ...settings, virtual_stake: value }),
                        '0.01',
                        '0'
                    )}

                    <label className='mw-vh__row'>
                        <span className='mw-vh__label'>
                            <Localize i18n_default_text='VH token' />
                        </span>
                        <input
                            className='mw-vh__input'
                            type='password'
                            autoComplete='off'
                            spellCheck={false}
                            value={token}
                            onChange={event => setToken(event.target.value)}
                        />
                    </label>

                    {/* Said plainly, because the consequence is not obvious:
                        people share bot files. */}
                    <p className='mw-vh__note'>
                        <Localize i18n_default_text='Kept in this browser only. It is never saved into the bot file, so exporting or sharing a bot cannot expose it.' />
                    </p>
                </div>

                <div className='mw-vh__footer'>
                    <button type='button' className='mw-vh__btn' onClick={close}>
                        <Localize i18n_default_text='Cancel' />
                    </button>
                    <button type='button' className='mw-vh__btn mw-vh__btn--primary' onClick={save}>
                        <Localize i18n_default_text='Save' />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VirtualHookModal;
