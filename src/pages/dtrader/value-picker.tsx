import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from '@deriv-com/translations';

/**
 * A field that opens Deriv's own picker: a pad of the values people actually
 * choose, and a keyboard for the ones they do not.
 *
 * Rendered into <body> rather than in place. The ticket scrolls its own
 * overflow on a desktop layout, so a panel positioned inside it would be
 * clipped by the ticket's edge and scroll away with the field - Deriv's opens
 * over the chart, beside the field, and so does this.
 */

export type TValuePickerProps = {
    /** What the field reads when closed, e.g. "5 ticks" or "1 USD". */
    display: string;
    label: string;
    max?: number;
    min?: number;
    onChange: (value: number) => void;
    onUnitChange?: (unit: string) => void;
    presetLabel: (value: number) => string;
    /** The pad's values. Ones outside min/max are dropped, not shown greyed. */
    presets: number[];
    step?: number;
    unit?: string;
    units?: { label: string; value: string }[];
    value: number;
};

const ValuePicker = ({
    display,
    label,
    max,
    min,
    onChange,
    onUnitChange,
    presetLabel,
    presets,
    step = 1,
    unit,
    units,
    value,
}: TValuePickerProps) => {
    const { localize } = useTranslations();
    const [is_open, setIsOpen] = useState(false);
    const [is_typing, setIsTyping] = useState(false);
    const [draft, setDraft] = useState(String(value));
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ left: 0, top: 0 });

    // Measured before paint so the panel never appears in one place and jumps
    // to another.
    useLayoutEffect(() => {
        if (!is_open || !trigger.current) return;
        const rect = trigger.current.getBoundingClientRect();
        const width = panel.current?.offsetWidth ?? 300;
        const height = panel.current?.offsetHeight ?? 260;
        // Beside the field, opening leftwards over the chart; below it instead
        // when there is no room to the left, and never off the bottom.
        const left = rect.left - width - 8 >= 8 ? rect.left - width - 8 : Math.max(8, rect.right - width);
        const top = Math.min(Math.max(8, rect.top), window.innerHeight - height - 8);
        setPosition({ left, top });
    }, [is_open]);

    useEffect(() => {
        if (!is_open) return undefined;
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
            setIsOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [is_open]);

    useEffect(() => setDraft(String(value)), [value]);

    const commit = (next: number) => {
        if (Number.isNaN(next)) return;
        const bounded = Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? 0, next));
        onChange(bounded);
    };

    const offered = presets.filter(preset => preset >= (min ?? 0) && preset <= (max ?? Number.MAX_SAFE_INTEGER));

    return (
        <>
            <button
                type='button'
                ref={trigger}
                className={`mw-dt__picker${is_open ? ' mw-dt__picker--open' : ''}`}
                aria-expanded={is_open}
                onClick={() => setIsOpen(open => !open)}
            >
                <span>{label}</span>
                <b>{display}</b>
            </button>

            {is_open &&
                createPortal(
                    <div
                        className='mw-dt__pad'
                        ref={panel}
                        role='dialog'
                        aria-label={label}
                        style={{ left: position.left, top: position.top }}
                    >
                        <div className='mw-dt__pad-modes'>
                            <button
                                type='button'
                                className={`mw-dt__pad-mode${is_typing ? '' : ' mw-dt__pad-mode--on'}`}
                                aria-label={localize('Common values')}
                                onClick={() => setIsTyping(false)}
                            >
                                ⚡
                            </button>
                            <button
                                type='button'
                                className={`mw-dt__pad-mode${is_typing ? ' mw-dt__pad-mode--on' : ''}`}
                                aria-label={localize('Type a value')}
                                onClick={() => setIsTyping(true)}
                            >
                                ⌨
                            </button>
                        </div>

                        {units && units.length > 1 && (
                            <div className='mw-dt__pad-units'>
                                {units.map(item => (
                                    <button
                                        key={item.value}
                                        type='button'
                                        className={`mw-dt__pad-unit${item.value === unit ? ' mw-dt__pad-unit--on' : ''}`}
                                        onClick={() => onUnitChange?.(item.value)}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {is_typing ? (
                            <div className='mw-dt__pad-type'>
                                <input
                                    type='number'
                                    autoFocus
                                    min={min}
                                    max={max}
                                    step={step}
                                    value={draft}
                                    aria-label={label}
                                    onChange={event => setDraft(event.target.value)}
                                    onKeyDown={event => {
                                        if (event.key !== 'Enter') return;
                                        commit(Number(draft));
                                        setIsOpen(false);
                                    }}
                                />
                                <button
                                    type='button'
                                    onClick={() => {
                                        commit(Number(draft));
                                        setIsOpen(false);
                                    }}
                                >
                                    {localize('Apply')}
                                </button>
                                {(min !== undefined || max !== undefined) && (
                                    <p>
                                        {localize('Allowed: {{min}} to {{max}}', {
                                            max: max ?? '-',
                                            min: min ?? '-',
                                        })}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div className='mw-dt__pad-grid'>
                                {offered.map(preset => (
                                    <button
                                        key={preset}
                                        type='button'
                                        className={`mw-dt__pad-chip${preset === value ? ' mw-dt__pad-chip--on' : ''}`}
                                        onClick={() => {
                                            commit(preset);
                                            setIsOpen(false);
                                        }}
                                    >
                                        {presetLabel(preset)}
                                    </button>
                                ))}
                                {offered.length === 0 && (
                                    <p className='mw-dt__pad-empty'>{localize('Type a value instead.')}</p>
                                )}
                            </div>
                        )}
                    </div>,
                    document.body
                )}
        </>
    );
};

export default ValuePicker;
