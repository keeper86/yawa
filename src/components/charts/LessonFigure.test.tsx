import { fireEvent, screen } from '@testing-library/react';
import { renderWithIntl } from 'tests/vitest/renderWithIntl';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Figure } from '@/lib/lesson';
import { LessonFigure } from './LessonFigure';

/* eslint-disable class-methods-use-this */
class ResizeObserverStub implements ResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
    }

    observe = (target: Element) => {
        const contentRect = { width: 640, height: 224, top: 0, left: 0, bottom: 224, right: 640, x: 0, y: 0 };
        this.callback([{ target, contentRect } as unknown as ResizeObserverEntry], this);
    };

    unobserve = () => undefined;

    disconnect = () => undefined;
}
/* eslint-enable class-methods-use-this */

beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 640 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 224 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 640 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 224 });
});

const figure: Figure = {
    template: 'trend',
    x: { label: 'Schrittweite', unit: 'm' },
    y: { label: 'Fehler', unit: 'm^2' },
    caption: 'Halbierung von h viertelt den Fehler.',
    series: [
        {
            label: 'Trapezfehler',
            points: [
                { x: 1, y: 0.1667 },
                { x: 0.5, y: 0.0417 },
                { x: 0.25, y: 0.0104 },
            ],
        },
    ],
};

describe('LessonFigure', () => {
    it('draws axes with tick labels and a grid', () => {
        const { container } = renderWithIntl(<LessonFigure figure={figure} />);

        expect(container.querySelector('svg')).not.toBeNull();
        expect(container.querySelectorAll('.recharts-cartesian-axis-tick').length).toBeGreaterThan(0);
        expect(container.querySelectorAll('.recharts-cartesian-grid line').length).toBeGreaterThan(0);
        expect(screen.getByText('Schrittweite (m)')).toBeInTheDocument();
        expect(screen.getByText('Fehler (m^2)')).toBeInTheDocument();
    });

    it('draws the series and the caption', () => {
        const { container } = renderWithIntl(<LessonFigure figure={figure} />);

        expect(container.querySelectorAll('.recharts-line').length).toBe(1);
        expect(screen.getByText('Halbierung von h viertelt den Fehler.')).toBeInTheDocument();
    });

    const yTicks = (container: HTMLElement) =>
        [...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick')].map(
            (node) => node.textContent,
        );

    it('opens on a log axis for a series that spans more than a decade', () => {
        renderWithIntl(<LessonFigure figure={figure} />, { locale: 'de' });

        expect(screen.getByRole('button', { name: 'Log' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Log-Achsen machen aus einem Potenzgesetz eine Gerade.')).toBeInTheDocument();
    });

    it('redraws the axis when the learner flips the scale', () => {
        const { container } = renderWithIntl(<LessonFigure figure={figure} />);
        const before = yTicks(container);
        expect(before.length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Linear' }));

        const after = yTicks(container);
        expect(after.length).toBeGreaterThan(0);
        expect(after).not.toEqual(before);
        expect(screen.getByRole('button', { name: 'Linear' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('draws bars over the named categories and never offers log', () => {
        const { container } = renderWithIntl(
            <LessonFigure
                figure={{
                    template: 'compare',
                    y: { label: 'Naeherung', unit: '1' },
                    caption: 'Linke Summe liegt unter dem exakten Wert.',
                    categories: ['linke Summe', 'exakt'],
                    series: [{ label: 'x^2 auf [0,1]', values: [0.25, 0.3333] }],
                }}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Log' })).toBeNull();
        expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(2);
        const xAxisText = container.querySelector('.recharts-xAxis')?.textContent ?? '';
        expect(xAxisText).toContain('linke Summe');
        expect(xAxisText).toContain('exakt');
    });
});
