import { BrowserRouter } from 'react-router-dom';
import { mockStore, StoreProvider } from '@/hooks/useStore';
import { mock_ws } from '@/utils/mock';
import { useDevice } from '@deriv-com/ui';
import { render, screen } from '@testing-library/react';
import MenuContent from '../menu-content';

jest.mock('@deriv-com/ui', () => ({
    ...jest.requireActual('@deriv-com/ui'),
    useDevice: jest.fn(() => ({ isDesktop: false })),
}));

describe('MenuContent Component', () => {
    const mock_store = mockStore(mock_ws as any);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <BrowserRouter>
            <StoreProvider mockStore={mock_store}>{children}</StoreProvider>
        </BrowserRouter>
    );

    beforeEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            value: jest.fn(),
            writable: true,
        });
    });

    it('renders the menu items and none of the links out of this app', () => {
        render(<MenuContent />, { wrapper });
        expect(screen.getByText(/Dark theme/)).toBeInTheDocument();
        expect(screen.getByText(/Responsible trading/)).toBeInTheDocument();
        // Removed on request, along with the platform switcher above them.
        expect(screen.queryByText(/Deriv.com/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Account Settings/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Cashier/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Help center/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Account limits/)).not.toBeInTheDocument();
    });

    it('adjusts text size for mobile devices', () => {
        render(<MenuContent />, { wrapper });
        const text = screen.getByText(/Dark theme/);
        expect(text).toHaveClass('derivs-text__size--md');
    });

    it('adjusts text size for desktop devices', () => {
        (useDevice as jest.Mock).mockReturnValue({ isDesktop: true });
        render(<MenuContent />, { wrapper });
        const text = screen.getByText(/Dark theme/);
        expect(text).toHaveClass('derivs-text__size--sm');
    });
});
