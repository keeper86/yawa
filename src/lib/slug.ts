import { foldText } from './text';

const MAX_SLUG_LENGTH = 120;

export const slugify = (title: string): string =>
    foldText(title)
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+$/g, '');
