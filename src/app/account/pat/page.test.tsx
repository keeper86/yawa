import type { PatToken } from '@/server/controller/pAccessToken';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithIntl } from 'tests/vitest/renderWithIntl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PatPage from './page';

const h = vi.hoisted(() => ({
    tokens: { current: [] as PatToken[] },
    refetch: vi.fn(),
    createPAT: vi.fn(),
    revokePAT: vi.fn(),
    deletePAT: vi.fn(),
    toast: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
    useTRPC: () => ({
        listPATs: { queryOptions: () => ({ queryKey: ['pats'] }) },
        createPAT: { mutationOptions: () => ({ mutationFn: h.createPAT }) },
        revokePAT: { mutationOptions: () => ({ mutationFn: h.revokePAT }) },
        deletePAT: { mutationOptions: () => ({ mutationFn: h.deletePAT }) },
    }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const original = (await importOriginal()) as typeof import('@tanstack/react-query');
    return {
        ...original,
        useQuery: () => ({ data: h.tokens.current, isLoading: false, refetch: h.refetch }),
        useMutation: (options: { mutationFn?: (input: unknown) => Promise<unknown> }) => ({
            mutateAsync: options.mutationFn ?? vi.fn(),
            isPending: false,
        }),
    };
});

vi.mock('sonner', () => ({ toast: { success: h.toast } }));

const mockConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

const mockWriteText = vi.fn(() => Promise.resolve());
Object.defineProperty(navigator, 'clipboard', {
    value: {
        writeText: mockWriteText,
    },
    writable: true,
});

const formatTimestamp = (value: string) =>
    new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value));

const existingTokens: PatToken[] = [
    {
        id: 'pat-1',
        name: 'Test Token 1',
        createdAt: '2025-01-01T10:00:00Z',
        expiresAt: '2025-01-08T10:00:00Z',
    },
    {
        id: 'pat-2',
        name: 'API Key',
        createdAt: '2025-02-15T12:00:00Z',
        expiresAt: '2025-03-15T12:00:00Z',
    },
];

describe('PatPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.tokens.current = [];
        mockConfirm.mockReturnValue(true);
        h.createPAT.mockReset();
        h.revokePAT.mockReset();
        h.deletePAT.mockReset();
    });

    it('renders the name field, expiry dropdown and generate button', () => {
        renderWithIntl(<PatPage />);

        expect(screen.getByRole('heading', { name: /Personal Access Tokens/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/Token name \(optional\)/i)).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Generate token/i })).toBeInTheDocument();

        expect(screen.getByRole('heading', { name: /Existing tokens/i })).toBeInTheDocument();
        expect(screen.getByText(/No tokens yet/i)).toBeInTheDocument();
    });

    it('renders name, created date and expiry of existing tokens', () => {
        h.tokens.current = existingTokens;
        renderWithIntl(<PatPage />);

        const first = screen.getByText('Test Token 1').closest('li');
        expect(first).toHaveTextContent(`Created ${formatTimestamp(existingTokens[0].createdAt)}`);
        expect(first).toHaveTextContent(`Expires ${formatTimestamp(existingTokens[0].expiresAt)}`);

        const second = screen.getByText('API Key').closest('li');
        expect(second).toHaveTextContent(`Expires ${formatTimestamp(existingTokens[1].expiresAt)}`);

        expect(screen.getAllByRole('button', { name: /Delete/i })).toHaveLength(2);
    });

    it('creates a token, shows the dialog and refetches the list', async () => {
        const newTokenValue = 'pat_newly_generated_secret_value';
        h.createPAT.mockResolvedValue({ token: newTokenValue });
        renderWithIntl(<PatPage />);

        fireEvent.change(screen.getByLabelText(/Token name \(optional\)/i), { target: { value: 'My New PAT' } });

        fireEvent.click(screen.getByRole('combobox'));
        fireEvent.click(screen.getByRole('option', { name: /1 month/i }));

        fireEvent.click(screen.getByRole('button', { name: /Generate token/i }));

        await waitFor(() => {
            expect(h.createPAT).toHaveBeenCalledWith({ name: 'My New PAT', expiresInDays: 30 });
        });

        const dialog = await screen.findByRole('dialog', { name: /Personal Access Token/i });
        expect(within(dialog).getByLabelText('Generated personal access token')).toHaveValue(newTokenValue);

        expect(h.refetch).toHaveBeenCalledTimes(1);
    });

    it('copies the generated token to the clipboard', async () => {
        const newTokenValue = 'pat_to_copy_123';
        h.createPAT.mockResolvedValue({ token: newTokenValue });
        renderWithIntl(<PatPage />);

        fireEvent.click(screen.getByRole('button', { name: /Generate token/i }));

        const dialog = await screen.findByRole('dialog', { name: /Personal Access Token/i });
        fireEvent.click(within(dialog).getByRole('button', { name: /Copy/i }));

        expect(mockWriteText).toHaveBeenCalledWith(newTokenValue);

        await waitFor(() => {
            expect(h.toast).toHaveBeenCalledWith('Token copied to clipboard');
        });
    });

    it('asks for confirmation before deleting a token', () => {
        h.tokens.current = existingTokens;
        renderWithIntl(<PatPage />);

        fireEvent.click(screen.getAllByRole('button', { name: /Delete/i })[0]);

        expect(mockConfirm).toHaveBeenCalledWith('Delete this personal access token? This cannot be undone.');
    });

    it('deletes the second token after confirmation and refetches', async () => {
        h.tokens.current = existingTokens;
        h.deletePAT.mockResolvedValue({ success: true });
        renderWithIntl(<PatPage />);

        fireEvent.click(screen.getAllByRole('button', { name: /Delete/i })[1]);

        await waitFor(() => {
            expect(h.deletePAT).toHaveBeenCalledWith({ id: 'pat-2' });
        });

        expect(h.refetch).toHaveBeenCalled();
    });

    it('skips the backend call when the delete confirmation is cancelled', async () => {
        h.tokens.current = existingTokens;
        mockConfirm.mockReturnValue(false);
        renderWithIntl(<PatPage />);

        fireEvent.click(screen.getAllByRole('button', { name: /Delete/i })[0]);

        await waitFor(() => {
            expect(h.deletePAT).not.toHaveBeenCalled();
            expect(h.refetch).not.toHaveBeenCalled();
        });
    });
});
