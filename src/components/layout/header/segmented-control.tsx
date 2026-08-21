import { useRef } from 'react';
import { motion } from 'framer-motion';
import './segmented-control.scss';

export type TSegmentOption = {
    value: string;
    label: string;
};

type TSegmentedControlProps = {
    id: string;
    options: TSegmentOption[];
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
};

/**
 * A compact currency switcher: one joined pill track with the active option
 * sitting on a filled segment that slides between them (shared via framer's
 * layoutId, so it animates across rather than reappearing).
 *
 * It reads as a single control on purpose. Two bare labels with a hairline
 * under the active one was the previous shape, and on the light theme the
 * active label was near-white on near-white - one label visible, one not,
 * which made the pair look like two unrelated words instead of a switch.
 */
const SegmentedControl = ({ id, options, value, onChange, ariaLabel }: TSegmentedControlProps) => {
    const button_refs = useRef<Array<HTMLButtonElement | null>>([]);

    const selectOption = (option: TSegmentOption) => {
        if (option.value === value) return;
        onChange(option.value);
    };

    const focusAndSelect = (index: number) => {
        const option = options[index];
        if (!option) return;
        button_refs.current[index]?.focus();
        selectOption(option);
    };

    const handleKeyDown = (event: React.KeyboardEvent, current_index: number) => {
        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                event.preventDefault();
                focusAndSelect((current_index + 1) % options.length);
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                event.preventDefault();
                focusAndSelect((current_index - 1 + options.length) % options.length);
                break;
            case 'Home':
                event.preventDefault();
                focusAndSelect(0);
                break;
            case 'End':
                event.preventDefault();
                focusAndSelect(options.length - 1);
                break;
            default:
                break;
        }
    };

    return (
        <div className='mw-dial' role='tablist' aria-label={ariaLabel}>
            {options.map((option, index) => {
                const is_active = option.value === value;
                return (
                    <button
                        type='button'
                        key={option.value}
                        ref={element => {
                            button_refs.current[index] = element;
                        }}
                        role='tab'
                        aria-selected={is_active}
                        tabIndex={is_active ? 0 : -1}
                        className={`mw-dial__option ${is_active ? 'mw-dial__option--active' : ''}`}
                        onClick={() => selectOption(option)}
                        onKeyDown={event => handleKeyDown(event, index)}
                    >
                        <span className='mw-dial__label'>{option.label}</span>
                        {is_active && (
                            <motion.span
                                layoutId={`mw-dial-underline-${id}`}
                                className='mw-dial__underline'
                                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default SegmentedControl;
