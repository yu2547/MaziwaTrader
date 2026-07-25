import React from 'react';
import classNames from 'classnames';
import Text from '@/components/shared_ui/text';
import { localize } from '@deriv-com/translations';
import { LinearProgressBar } from '@deriv-com/ui';
import { QsSteps } from './trade-constants';

type TQSStepper = {
    current_step: QsSteps;
    is_mobile?: boolean;
};

/**
 * Minimal in-house replacement for @deriv-com/quill-ui's VerticalStepper (removed
 * to drop that package's ~3.4MB CSS chunk - see H1 in the performance review).
 * Same 3-step "completed / active / upcoming" progress indicator.
 */
const VerticalStepper = ({ currentStep, labels }: { currentStep: number; labels: string[] }) => (
    <ol className='qs-stepper__list'>
        {labels.map((label, index) => (
            <li
                key={label}
                className={classNames('step', {
                    'step--completed': index < currentStep,
                    'step--active': index === currentStep,
                })}
            >
                <span className='step__marker' />
                <Text as='span' size='xs'>
                    {label}
                </Text>
            </li>
        ))}
    </ol>
);

const QSStepper = ({ current_step, is_mobile = false }: TQSStepper) => {
    const percentage = current_step === QsSteps.StrategyCompleted ? 100 : 50;
    return is_mobile ? (
        <LinearProgressBar percentage={percentage} label='' danger_limit={101} is_loading={false} warning_limit={0} />
    ) : (
        <div className='qs-stepper'>
            <VerticalStepper
                currentStep={current_step}
                labels={[localize('Default'), localize('Strategy template'), localize('Trade parameters')]}
            />
        </div>
    );
};

export default QSStepper;
