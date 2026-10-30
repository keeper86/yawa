import { fireEvent, screen } from '@testing-library/react';
import { renderWithIntl } from 'tests/vitest/renderWithIntl';
import { describe, expect, it, vi } from 'vitest';
import { ReviewQueue } from './ReviewQueue';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

const act = {
    id: 'act-1',
    conceptId: 'concept-1',
    conceptTitle: 'Trapezregel',
    templateKey: 'worked-example',
    title: 'Trapezregel mit zwei Teilen',
    rubric: ['grounded-in-source', 'single-concept'],
    status: 'proposed' as const,
    script: {
        steps: [
            { role: 'setup', text: 'Gesucht ist das Integral.' },
            { role: 'check', text: 'Berechne den Wert.' },
        ],
        success: { criterion: 'Der Wert ist berechnet.' },
    },
};

vi.mock('@/hooks/useReviewQueue', () => ({
    useLectureActs: () => ({ data: [act], isPending: false, isError: false, error: null }),
    useReviewAct: () => ({ mutate, isPending: false }),
    useActDetail: () => ({ data: { grounding: [] } }),
}));

describe('ReviewQueue', () => {
    it('shows the act, its template label and its rubric', () => {
        renderWithIntl(<ReviewQueue lectureId='lecture-1' />);

        expect(screen.getByText('Trapezregel mit zwei Teilen')).toBeInTheDocument();
        expect(screen.getByText('Worked example')).toBeInTheDocument();
        expect(screen.getByText(/Every step traces back to a passage/)).toBeInTheDocument();
        expect(screen.getByText('Der Wert ist berechnet.')).toBeInTheDocument();
    });

    it('accepts with the keyboard', () => {
        mutate.mockClear();
        renderWithIntl(<ReviewQueue lectureId='lecture-1' />);

        fireEvent.keyDown(window, { key: 'a' });

        expect(mutate).toHaveBeenCalledWith(
            { actId: 'act-1', decision: 'accepted' },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
    });

    it('rejects with the keyboard', () => {
        mutate.mockClear();
        renderWithIntl(<ReviewQueue lectureId='lecture-1' />);

        fireEvent.keyDown(window, { key: 'r' });

        expect(mutate).toHaveBeenCalledWith(
            { actId: 'act-1', decision: 'rejected' },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
    });

    it('accepts with the button', () => {
        mutate.mockClear();
        renderWithIntl(<ReviewQueue lectureId='lecture-1' />);

        fireEvent.click(screen.getByRole('button', { name: /Accept/ }));

        expect(mutate).toHaveBeenCalledWith(
            { actId: 'act-1', decision: 'accepted' },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
    });
});
