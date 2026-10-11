import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ThemeWrapper from './themeWrapper';

describe('ThemeWrapper', () => {
    it('renders nothing while server rendering', () => {
        expect(renderToString(<ThemeWrapper>content</ThemeWrapper>)).toBe('');
    });

    it('renders its children on the client', () => {
        render(<ThemeWrapper>content</ThemeWrapper>);

        expect(screen.getByText('content')).toBeInTheDocument();
    });
});
