import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageSummary } from '@/server/controller/message';

vi.mock('@/components/client/UserAvatar', () => ({
    default: ({ userId }: { userId?: string }) => <div data-testid='user-avatar'>{userId}</div>,
}));

import { CounterpartAvatar } from './CounterpartAvatar';

const message = (overrides: Partial<MessageSummary>): MessageSummary => ({
    id: 'm1',
    subject: 'Hello',
    createdAt: '2026-09-26T12:00:00.000Z',
    readAt: null,
    counterpartUserId: 'user-2',
    counterpartDisplayName: 'Bob Brown',
    counterpartUsername: 'bobby',
    counterpartDeleted: false,
    ...overrides,
});

describe('CounterpartAvatar', () => {
    it('shows the user avatar for the counterpart', () => {
        render(<CounterpartAvatar message={message({})} />);

        expect(screen.getByTestId('user-avatar')).toHaveTextContent('user-2');
    });
});
