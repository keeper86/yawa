import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWikiClient, type WikiJsonFetch } from './client';
import { wikitextToText } from './wikitext';

const fixture = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/wiki', name), 'utf8'));

const fixtureFetch = (overrides: Record<string, unknown> = {}): WikiJsonFetch => {
    return async (url) => {
        for (const [needle, value] of Object.entries(overrides)) {
            if (url.includes(needle)) {
                return value;
            }
        }
        if (url.includes('meta=siteinfo')) {
            return fixture('rightsinfo.json');
        }
        if (url.includes('list=search')) {
            return { query: { search: [{ title: 'Trapezoidal rule', pageid: 573452 }] } };
        }
        if (url.includes('prop=tocdata')) {
            return fixture('tocdata.json');
        }
        if (url.includes('section=')) {
            return fixture('section-2.json');
        }
        if (url.includes('redirects=1')) {
            return fixture('page-meta.json');
        }
        return fixture('page-meta.json');
    };
};

describe('wiki client', () => {
    it('reads the licence from siteinfo', async () => {
        const rights = await createWikiClient(fixtureFetch()).siteRights('en');

        expect(rights.license).toBe('Creative Commons Attribution-Share Alike 4.0');
        expect(rights.licenseUrl).toContain('creativecommons.org');
    });

    it('reads page identity and the wikidata item', async () => {
        const meta = await createWikiClient(fixtureFetch()).pageMeta('Trapezoidal rule', 'en');

        expect(meta.pageId).toBe(573452);
        expect(meta.lastRevId).toBe(1378446929);
        expect(meta.wikidataId).toBe('Q833293');
        expect(meta.isDisambiguation).toBe(false);
    });

    it('recognises a disambiguation page', async () => {
        const meta = await createWikiClient(
            fixtureFetch({ 'titles=Derivative': fixture('disambiguation.json') }),
        ).pageMeta('Derivative (disambiguation)', 'en');

        expect(meta.isDisambiguation).toBe(true);
    });

    it('resolves a redirect to the canonical title', async () => {
        const meta = await createWikiClient(fixtureFetch({ 'titles=Trapezoid': fixture('redirect.json') })).pageMeta(
            'Trapezoid rule',
            'en',
        );

        expect(meta.title).toBe('Trapezoidal rule');
    });

    it('returns only top level sections', async () => {
        const sections = await createWikiClient(fixtureFetch()).sections('Trapezoidal rule', 'en');

        expect(sections.length).toBeGreaterThan(3);
        expect(sections[0]).toEqual({ index: '1', heading: 'History', anchor: 'History' });
    });
});

describe('wikitextToText', () => {
    it('keeps the prose of a real section and drops markup', () => {
        const text = wikitextToText(fixture('section-2.json').parse.wikitext);

        expect(text).toContain('When the grid spacing is non-uniform');
        expect(text).not.toContain('{{');
        expect(text).not.toContain('[[');
        expect(text).not.toContain('<math');
        expect(text).not.toContain('== ');
    });

    it('keeps the latex body of a formula as text', () => {
        const text = wikitextToText(fixture('section-2.json').parse.wikitext);

        expect(text).toContain('\\int_a^b f(x)');
    });

    it('unwraps piped links to their label and plain links to their target', () => {
        expect(wikitextToText('siehe [[Finite difference#Basic types|zentrale Differenzen]]')).toBe(
            'siehe zentrale Differenzen',
        );
        expect(wikitextToText('siehe [[Trapezregel]]')).toBe('siehe Trapezregel');
    });

    it('drops references, tables and files', () => {
        const text = wikitextToText(
            'Text<ref>Quelle</ref> mehr\n{| class="wikitable"\n| Zelle\n|}\n[[File:Bild.png|mini|Bild]] Ende',
        );

        expect(text).toBe('Text mehr\n\n Ende');
    });
});
