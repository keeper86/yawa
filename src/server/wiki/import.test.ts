import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDb } from 'tests/vitest/setupTestcontainer';
import { createWikiClient, type WikiJsonFetch } from './client';
import { importArticle } from './import';

const fixture = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/wiki', name), 'utf8'));

const buildClient = (overrides: Record<string, unknown> = {}) => {
    const fetchJson: WikiJsonFetch = async (url) => {
        for (const [needle, value] of Object.entries(overrides)) {
            if (url.includes(needle)) {
                return value;
            }
        }
        if (url.includes('meta=siteinfo')) {
            return fixture('rightsinfo.json');
        }
        if (url.includes('prop=tocdata')) {
            return {
                parse: {
                    tocdata: {
                        sections: [
                            {
                                tocLevel: 1,
                                hLevel: 2,
                                line: 'Numerical implementation',
                                index: '2',
                                anchor: 'Numerical_implementation',
                            },
                            { tocLevel: 1, hLevel: 2, line: 'References', index: '9', anchor: 'References' },
                        ],
                    },
                },
            };
        }
        if (url.includes('section=9')) {
            return { parse: { wikitext: 'Kurzer Verweis auf andere Artikel.' } };
        }
        if (url.includes('section=2')) {
            return fixture('section-2.json');
        }
        return fixture('page-meta.json');
    };
    return createWikiClient(fetchJson);
};

describe('importArticle', () => {
    it('stores the article with licence, revision and permalink', async () => {
        const { source, sections } = await importArticle(getDb(), {
            title: 'Trapezoidal rule',
            language: 'en',
            client: buildClient(),
        });

        expect(source.kind).toBe('wikipedia');
        expect(source.owner_user_id).toBeNull();
        expect(source.external_id).toBe('enwiki:573452');
        expect(source.source_revision).toBe('1378446929');
        expect(source.license).toBe('Creative Commons Attribution-Share Alike 4.0');
        expect(source.uri).toContain('oldid=1378446929');
        expect(sections).toBe(1);
    });

    it('skips the references section and keeps only substantial prose', async () => {
        const { source } = await importArticle(getDb(), {
            title: 'Trapezoidal rule',
            language: 'en',
            client: buildClient(),
        });

        const stored = await getDb()('source_sections').where({ source_id: source.id });
        expect(stored).toHaveLength(1);
        expect(stored[0].heading).toBe('Numerical implementation');
        expect(stored[0].content.length).toBeGreaterThan(200);
        expect(stored[0].content).not.toContain('{{');
    });

    it('is idempotent for the same revision', async () => {
        const client = buildClient();
        const first = await importArticle(getDb(), { title: 'Trapezoidal rule', language: 'en', client });
        const second = await importArticle(getDb(), { title: 'Trapezoidal rule', language: 'en', client });

        expect(second.source.id).toBe(first.source.id);
        expect(await getDb()('sources').where({ external_id: 'enwiki:573452' })).toHaveLength(1);
    });

    it('creates a new revision row instead of overwriting a grounded source', async () => {
        const client = buildClient();
        const first = await importArticle(getDb(), { title: 'Trapezoidal rule', language: 'en', client });

        const newer = await importArticle(getDb(), {
            title: 'Trapezoidal rule',
            language: 'en',
            client: buildClient({
                'prop=info%7Cpageprops': {
                    query: { pages: [{ ...fixture('page-meta.json').query.pages[0], lastrevid: 1378446930 }] },
                },
            }),
        });

        expect(newer.source.id).not.toBe(first.source.id);
        expect(newer.source.external_id).toBe('enwiki:573452@1378446930');
    });

    it('refuses a disambiguation page', async () => {
        await expect(
            importArticle(getDb(), {
                title: 'Derivative (disambiguation)',
                language: 'en',
                client: buildClient({ 'titles=Derivative': fixture('disambiguation.json') }),
            }),
        ).rejects.toThrow(/disambiguation/);
    });
});
