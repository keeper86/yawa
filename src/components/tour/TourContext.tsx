'use client';

import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

const STORAGE_KEY = 'yawa-tour';

type TourStorage = {
    active: boolean;
    currentStepIndex: number;
    completed: boolean;
    completedActions: string[];
};

function isTourStorage(raw: unknown): raw is TourStorage {
    if (typeof raw !== 'object' || raw === null) {
        return false;
    }
    const candidate = raw as Record<string, unknown>;
    return (
        typeof candidate.active === 'boolean' &&
        typeof candidate.currentStepIndex === 'number' &&
        Number.isInteger(candidate.currentStepIndex) &&
        candidate.currentStepIndex >= 0 &&
        typeof candidate.completed === 'boolean' &&
        Array.isArray(candidate.completedActions) &&
        candidate.completedActions.every((action) => typeof action === 'string')
    );
}

type TourContextValue = {
    isTourActive: boolean;
    setTourActive: (active: boolean) => void;
    currentStepIndex: number;
    setCurrentStepIndex: (index: number) => void;
    isCompleted: boolean;
    completeTour: () => void;
    resetTour: () => void;
    advanceToNextStep: () => void;
    completedActions: string[];
    markActionCompleted: (action: string) => void;
};

const defaultStorage: TourStorage = {
    active: false,
    currentStepIndex: 0,
    completed: false,
    completedActions: [],
};

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
    const [storage, setStorage] = useLocalStorageState<TourStorage>(STORAGE_KEY, defaultStorage, isTourStorage);

    const persist = useCallback(
        (update: Partial<TourStorage>) => {
            setStorage((prev) => ({ ...prev, ...update }));
        },
        [setStorage],
    );

    const isTourActive = storage.active;
    const currentStepIndex = storage.currentStepIndex;
    const isCompleted = storage.completed;
    const completedActions = storage.completedActions;

    const setTourActive = useCallback(
        (active: boolean) => {
            persist({ active, currentStepIndex: 0, completed: false, completedActions: [] });
        },
        [persist],
    );

    const setCurrentStepIndex = useCallback(
        (index: number) => {
            persist({ currentStepIndex: index });
        },
        [persist],
    );

    const advanceToNextStep = useCallback(() => {
        setStorage((prev) => ({ ...prev, currentStepIndex: prev.currentStepIndex + 1 }));
    }, [setStorage]);

    const completeTour = useCallback(() => {
        persist({ active: false, completed: true });
    }, [persist]);

    const resetTour = useCallback(() => {
        persist({ active: true, currentStepIndex: 0, completed: false, completedActions: [] });
    }, [persist]);

    const markActionCompleted = useCallback(
        (action: string) => {
            setStorage((prev) => {
                if (prev.completedActions.includes(action)) {
                    return prev;
                }
                return { ...prev, completedActions: [...prev.completedActions, action] };
            });
        },
        [setStorage],
    );

    return (
        <TourContext.Provider
            value={{
                isTourActive,
                setTourActive,
                currentStepIndex,
                setCurrentStepIndex,
                isCompleted,
                completeTour,
                resetTour,
                advanceToNextStep,
                completedActions,
                markActionCompleted,
            }}
        >
            {children}
        </TourContext.Provider>
    );
}

export function useTour(): TourContextValue {
    const ctx = useContext(TourContext);
    if (!ctx) {
        throw new Error('useTour must be used within a TourProvider');
    }
    return ctx;
}
