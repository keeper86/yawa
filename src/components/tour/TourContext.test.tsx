import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetLocalStorageStores } from '@/hooks/useLocalStorageState';
import { TourProvider, useTour } from './TourContext';

const STORAGE_KEY = 'yawa-tour';

function Probe() {
    const {
        isTourActive,
        currentStepIndex,
        isCompleted,
        completedActions,
        setTourActive,
        advanceToNextStep,
        markActionCompleted,
        completeTour,
        resetTour,
    } = useTour();

    return (
        <div>
            <span data-testid='active'>{String(isTourActive)}</span>
            <span data-testid='step'>{currentStepIndex}</span>
            <span data-testid='completed'>{String(isCompleted)}</span>
            <span data-testid='actions'>{completedActions.join(',')}</span>
            <button onClick={() => setTourActive(true)}>start</button>
            <button onClick={advanceToNextStep}>next-step</button>
            <button onClick={() => markActionCompleted('action-a')}>mark</button>
            <button onClick={completeTour}>complete</button>
            <button onClick={resetTour}>reset</button>
        </div>
    );
}

const renderProbe = () =>
    render(
        <TourProvider>
            <Probe />
        </TourProvider>,
    );

beforeEach(() => {
    resetLocalStorageStores();
    localStorage.clear();
});

describe('TourContext', () => {
    it('starts inactive with default state', () => {
        const { getByTestId } = renderProbe();

        expect(getByTestId('active')).toHaveTextContent('false');
        expect(getByTestId('step')).toHaveTextContent('0');
        expect(getByTestId('completed')).toHaveTextContent('false');
    });

    it('activates and persists to storage', () => {
        const { getByText, getByTestId } = renderProbe();

        fireEvent.click(getByText('start'));

        expect(getByTestId('active')).toHaveTextContent('true');
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        expect(stored.active).toBe(true);
    });

    it('advances the step index and persists', () => {
        const { getByText, getByTestId } = renderProbe();

        fireEvent.click(getByText('next-step'));
        fireEvent.click(getByText('next-step'));

        expect(getByTestId('step')).toHaveTextContent('2');
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        expect(stored.currentStepIndex).toBe(2);
    });

    it('records completed actions without duplicates', () => {
        const { getByText, getByTestId } = renderProbe();

        fireEvent.click(getByText('mark'));
        fireEvent.click(getByText('mark'));

        expect(getByTestId('actions')).toHaveTextContent('action-a');
    });

    it('completes and resets the tour', () => {
        const { getByText, getByTestId } = renderProbe();

        fireEvent.click(getByText('complete'));
        expect(getByTestId('completed')).toHaveTextContent('true');
        expect(getByTestId('active')).toHaveTextContent('false');

        fireEvent.click(getByText('reset'));
        expect(getByTestId('active')).toHaveTextContent('true');
        expect(getByTestId('completed')).toHaveTextContent('false');
    });

    it('ignores malformed stored JSON and falls back to defaults', () => {
        localStorage.setItem(STORAGE_KEY, '{not-json');

        const { getByTestId } = renderProbe();

        expect(getByTestId('active')).toHaveTextContent('false');
        expect(getByTestId('step')).toHaveTextContent('0');
    });

    it('ignores wrong-typed stored fields', () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ active: 'yes', currentStepIndex: '3', completed: false, completedActions: ['x'] }),
        );

        const { getByTestId } = renderProbe();

        expect(getByTestId('active')).toHaveTextContent('false');
        expect(getByTestId('step')).toHaveTextContent('0');
    });
});
