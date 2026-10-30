import { useEffect, useState } from 'react';

const TICK_MS = 500;

export const useElapsedSeconds = (active: boolean): number => {
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        if (!active) {
            return;
        }
        const startedAt = Date.now();
        const tick = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), TICK_MS);
        return () => {
            clearInterval(tick);
            setSeconds(0);
        };
    }, [active]);

    return active ? seconds : 0;
};
