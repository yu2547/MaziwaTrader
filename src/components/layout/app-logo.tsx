import React from 'react';
import { useDevice } from '@deriv-com/ui';
import './app-logo.scss';

export const AppLogo = () => {
    const { isDesktop } = useDevice();

    return (
        <div className='app-logo' onClick={() => window.location.assign('/')}>
            <img
                src='/logo.png'
                alt='Maziwa Trader Logo'
                className='app-logo__image'
                style={{ height: isDesktop ? '40px' : '32px', cursor: 'pointer' }}
            />
            {isDesktop && (
                <span
                    className='app-logo__text'
                    style={{ marginLeft: '8px', fontWeight: 'bold', fontSize: '1.8rem', color: 'var(--text-general)' }}
                >
                    Maziwa Trader
                </span>
            )}
        </div>
    );
};
