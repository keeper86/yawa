'use client';

import { useIsClient } from '@/hooks/useIsClient';
import type { ReactNode } from 'react';

export default function ThemeWrapper({ children }: { children: ReactNode }) {
    const isClient = useIsClient();

    if (!isClient) {
        return null;
    }

    return <>{children}</>;
}
