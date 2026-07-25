import React from 'react';
import classNames from 'classnames';
import { LegacyChevronRight1pxIcon } from '@deriv/quill-icons/Legacy';
import Text from '../text';

export type TLinkProps = {
    children?: React.ReactNode;
    className?: string;
    hasChevron?: boolean;
    href?: string;
    onClick?: (event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => void;
    size?: string;
    target?: string;
};

/**
 * Minimal in-house replacement for @deriv-com/quill-ui's Link (removed to drop that
 * package's ~3.4MB CSS chunk - see H1 in the performance review). Renders as an <a>
 * when href is given, otherwise a <button>, matching how Link was used across the
 * app (plain click handler in most places, a real href in the TNC modal).
 */
const Link = ({ children, className, hasChevron, href, onClick, size = 'xs', target, ...props }: TLinkProps) => {
    const content = (
        <>
            <Text as='span' size={size} className='dc-link__text'>
                {children}
            </Text>
            {hasChevron && <LegacyChevronRight1pxIcon className='dc-link__chevron' iconSize='xs' />}
        </>
    );
    const classes = classNames('dc-link', className);

    if (href) {
        return (
            <a
                className={classes}
                href={href}
                onClick={onClick}
                target={target ?? '_blank'}
                rel='noopener noreferrer'
                {...props}
            >
                {content}
            </a>
        );
    }

    return (
        <button type='button' className={classes} onClick={onClick} {...props}>
            {content}
        </button>
    );
};

export default Link;
