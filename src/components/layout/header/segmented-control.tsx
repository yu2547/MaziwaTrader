import { useRef } from 'react';
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
 * The currency switcher, drawn as a small rocker: the selected currency is the
 * face pressed flat, the other is the raised face tipped toward the viewer, so
 * choosing the other one rocks the switch across. The shape lives entirely in
 * segmented-control.scss - this component only marks which face is active.
 *
 * It reads as a single control on purpose. Two bare labels with a hairline
 * under the active one was an earlier shape, and on the light theme the
 * active label was near-white on near-white - one label visible, one not,
 * which made the pair look like two unrelated words instead of a switch.
 */
const SegmentedControl = ({ id, options, value, onChange, ariaLabel }: TSegmentedControlProps) => {
    const button_refs = useRef<Array<HTMLButtonElement | null>>([]);

    const selectOption = (option: TSegmentOption) => {
        if (option.value === value) return;
        onChange(option.value);
    };

    // A two-way switch flips on any press, the way a physical one does:
    // tapping the key that is already down switches it too, instead of doing
    // nothing. Only clicks and taps do this - the arrow, Home and End keys keep
    // their usual meaning of "go to that option" and never flip past it.
    const handleClick = (option: TSegmentOption, index: number) => {
        if (option.value === value && options.length === 2) {
            const other_index = index === 0 ? 1 : 0;
            button_refs.current[other_index]?.focus();
            onChange(options[other_index].value);
            return;
        }
        selectOption(option);
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
        <div className='mw-dial' id={id} role='tablist' aria-label={ariaLabel}>
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
                        onClick={() => handleClick(option, index)}
                        onKeyDown={event => handleKeyDown(event, index)}
                    >
                        {/* The label is the key's face: on the key that is not
                            selected it is what lifts and tips, uncovering the
                            button under it as the key's front side. */}
                        <span className='mw-dial__label'>{option.label}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default SegmentedControl;
