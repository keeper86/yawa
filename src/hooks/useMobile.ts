import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;
const SMALL_SCREEN_BREAKPOINT = 400;

function createMediaQuerySubscription(breakpoint: number) {
    return (onChange: () => void) => {
        const mediaQueryList = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
        mediaQueryList.addEventListener('change', onChange);
        return () => mediaQueryList.removeEventListener('change', onChange);
    };
}

const subscribeToMobile = createMediaQuerySubscription(MOBILE_BREAKPOINT);
const subscribeToSmallScreen = createMediaQuerySubscription(SMALL_SCREEN_BREAKPOINT);

const getIsMobile = () => window.innerWidth < MOBILE_BREAKPOINT;
const getIsSmallScreen = () => window.innerWidth < SMALL_SCREEN_BREAKPOINT;
const getServerSnapshot = () => false;

export function useIsMobile(): boolean {
    return useSyncExternalStore(subscribeToMobile, getIsMobile, getServerSnapshot);
}

export function useIsSmallScreen(): boolean {
    return useSyncExternalStore(subscribeToSmallScreen, getIsSmallScreen, getServerSnapshot);
}
