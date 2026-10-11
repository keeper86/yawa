import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from 'tests/vitest/renderWithIntl';

type TourEventData = Record<string, unknown>;
type TourEventHandler = (data: TourEventData) => void;

let capturedOnEvent: TourEventHandler | null = null;

vi.mock('react-joyride', () => ({
    Joyride: (props: { onEvent?: TourEventHandler }) => {
        capturedOnEvent = props.onEvent ?? null;
        return null;
    },
}));

vi.mock('next/dynamic', () => ({
    default: () => (props: { onEvent?: TourEventHandler }) => {
        capturedOnEvent = props.onEvent ?? null;
        return null;
    },
}));

vi.mock('./TourContext', () => ({ useTour: vi.fn() }));

vi.mock('./tourSteps', () => ({
    getStepsForPage: vi.fn(() => [
        { target: 'body', content: 'First', title: 'First' },
        { target: 'body', content: 'Second', title: 'Second' },
    ]),
}));

vi.mock('@/hooks/useNavigationGuard', () => ({ useNavigationGuard: vi.fn() }));
vi.mock('@/components/tour/TourTooltip', () => ({ TourTooltip: () => null }));

import { useTour } from './TourContext';
import { TourJoyride } from './TourJoyride';

const tourMock = useTour as unknown as ReturnType<typeof vi.fn>;

const setMockTour = (overrides: Record<string, unknown> = {}) => {
    tourMock.mockReturnValue({
        isTourActive: true,
        currentStepIndex: 0,
        completeTour: vi.fn(),
        setCurrentStepIndex: vi.fn(),
        completedActions: [],
        ...overrides,
    });
};

const event = (data: Record<string, unknown>): Record<string, unknown> => data;

beforeEach(() => {
    vi.clearAllMocks();
    capturedOnEvent = null;
});

describe('TourJoyride', () => {
    it('renders nothing when the tour is inactive', () => {
        setMockTour({ isTourActive: false });

        const { container } = renderWithIntl(<TourJoyride />);

        expect(container.innerHTML).toBe('');
    });

    it('completes the tour when the last step is finished', () => {
        const completeTour = vi.fn();
        setMockTour({ completeTour, currentStepIndex: 1 });

        renderWithIntl(<TourJoyride />);

        expect(capturedOnEvent).toBeTruthy();
        capturedOnEvent!(event({ type: 'step:after', status: 'running', action: 'next', index: 1 }));

        expect(completeTour).toHaveBeenCalled();
    });

    it('advances to the next step while running', () => {
        const setCurrentStepIndex = vi.fn();
        setMockTour({ setCurrentStepIndex });

        renderWithIntl(<TourJoyride />);
        capturedOnEvent!(event({ type: 'step:after', status: 'running', action: 'next', index: 0 }));

        expect(setCurrentStepIndex).toHaveBeenCalledWith(1);
    });

    it('completes the tour when closed', () => {
        const completeTour = vi.fn();
        setMockTour({ completeTour });

        renderWithIntl(<TourJoyride />);
        capturedOnEvent!(event({ type: 'tour:end', status: 'skipped', action: 'close', index: 0 }));

        expect(completeTour).toHaveBeenCalled();
    });
});
