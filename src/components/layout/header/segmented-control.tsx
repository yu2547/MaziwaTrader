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
 * Shared premium segmented-control primitive (glassmorphism, sliding
 * spring-physics indicator) used by both the currency and account-type
 * selectors in the header - kept generic/reusable rather than duplicating
 * the same animation logic twice.
 *
 * Implements the WAI-ARIA tablist roving-tabindex pattern: only the active
 * segment sits in the natural Tab order, and Left/Right/Home/End move focus
 * (and selection - a segmented control is a single-choice input, so
 * automatic activation on arrow press matches how a native radio group
 * behaves) between segments without a Tab keypress per segment.
 */
const SegmentedControl = ({ id, options, value, onChange, ariaLabel }: TSegmentedControlProps) => {
    const button_refs = useRef<Array<HTMLButtonElement | null>>([]);

    const focusAndSelect = (index: number) => {
        const option = options[index];
        if (!option) return;
        button_refs.current[index]?.focus();
        onChange(option.value);
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
        <div className='mw-segmented' role='tablist' aria-label={ariaLabel}>
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
                        className={`mw-segmented__option ${is_active ? 'mw-segmented__option--active' : ''}`}
                        onClick={() => onChange(option.value)}
                        onKeyDown={event => handleKeyDown(event, index)}
                    >
                        {is_active && (
                            <motion.span
                                layoutId={`mw-segmented-indicator-${id}`}
                                className='mw-segmented__indicator'
                                transition={{ type: 'spring', stiffness: 460, damping: 24, mass: 0.85 }}
                            />
                        )}
                        <span className='mw-segmented__label'>{option.label}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default SegmentedControl;
