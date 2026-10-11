import { useSyncExternalStore } from 'react';

const subscribe = (): (() => void) => () => undefined;

const getSnapshot = (): boolean => true;

const getServerSnapshot = (): boolean => false;

export function useIsClient(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
