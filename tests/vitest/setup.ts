import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

vi.mock('next/navigation', () => ({
    useRouter: () => ({
        push: vi.fn(),
        replace: vi.fn(),
        prefetch: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        refresh: vi.fn(),
    }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => {
        const listeners = new Set<(e: MediaQueryListEvent) => void>();
        const mql = {
            matches: false,
            media: query,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
            onchange: null as Function | null,
            addEventListener: (type: string, listener: (e: MediaQueryListEvent) => void) => {
                if (type === 'change') {
                    listeners.add(listener);
                }
            },
            removeEventListener: (type: string, listener: (e: MediaQueryListEvent) => void) => {
                if (type === 'change') {
                    listeners.delete(listener);
                }
            },
            addListener: (listener: (e: MediaQueryListEvent) => void) => {
                listeners.add(listener);
            },
            removeListener: (listener: (e: MediaQueryListEvent) => void) => {
                listeners.delete(listener);
            },
            dispatchEvent: (event: MediaQueryListEvent) => {
                listeners.forEach((l) => l(event));
                return true;
            },
        } as Partial<MediaQueryList> & { dispatchEvent: (e: MediaQueryListEvent) => boolean };

        return mql as MediaQueryList;
    },
});
