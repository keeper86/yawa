import type { Sources, Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import { DomainFailure } from '../domainError';
import { createHash } from 'node:crypto';
import type { WikiClient } from './client';
import { wikitextToText } from './wikitext';

const SKIPPED_HEADINGS = [
    'references',
    'external links',
    'see also',
    'notes',
    'further reading',
    'bibliography',
    'sources',
    'citations',
];

const MIN_SECTION_LENGTH = 200;

export type ImportedArticle = {
    source: Sources;
    sections: number;
};

export type ImportInput = {
    title: string;
    language: string;
    client: WikiClient;
};

const permalink = (language: string, revisionId: number) =>
    `https://${language}.wikipedia.org/w/index.php?oldid=${revisionId}`;

const isUsefulSection = (heading: string, text: string) =>
    !SKIPPED_HEADINGS.includes(heading.trim().toLowerCase()) && text.length >= MIN_SECTION_LENGTH;

export const importArticle = async (db: Knex<Tables>, input: ImportInput): Promise<ImportedArticle> => {
    const meta = await input.client.pageMeta(input.title, input.language);
    if (meta.isDisambiguation) {
        throw new DomainFailure('sourceNotFound', `${meta.title} is a disambiguation page`);
    }

    const externalId = `${input.language}wiki:${meta.pageId}`;
    const existing = await db('sources').where({ external_id: externalId }).whereNull('owner_user_id').first();
    if (existing && existing.source_revision === String(meta.lastRevId)) {
        const count = await db('source_sections')
            .where({ source_id: existing.id })
            .count<{ count: string }>('* as count')
            .first();
        return { source: existing, sections: Number(count?.count ?? 0) };
    }

    const rights = await input.client.siteRights(input.language);
    const refs = await input.client.sections(meta.title, input.language);

    const collected: { heading: string; anchor: string; content: string; contentHash: string }[] = [];
    for (const ref of refs) {
        const text = wikitextToText(await input.client.sectionWikitext(meta.title, ref.index, input.language));
        if (!isUsefulSection(ref.heading, text)) {
            continue;
        }
        collected.push({
            heading: ref.heading,
            anchor: ref.anchor,
            content: text,
            contentHash: createHash('sha256').update(text).digest('hex'),
        });
    }

    if (collected.length === 0) {
        throw new DomainFailure('sourceNotFound', `${meta.title} has no usable sections`);
    }

    const revisionSuffix = existing ? `@${meta.lastRevId}` : '';

    return db.transaction(async (trx) => {
        const [source] = await trx('sources')
            .insert({
                owner_user_id: null,
                kind: 'wikipedia',
                external_id: `${externalId}${revisionSuffix}`,
                title: meta.title,
                language: input.language,
                uri: permalink(input.language, meta.lastRevId),
                license: rights.license,
                license_url: rights.licenseUrl,
                source_revision: String(meta.lastRevId),
                fetched_at: new Date(),
            })
            .returning('*');

        await trx('source_sections').insert(
            collected.map((section, position) => ({
                source_id: source.id,
                position,
                heading: section.heading,
                anchor: section.anchor,
                content: section.content,
                content_hash: section.contentHash,
            })),
        );

        return { source, sections: collected.length };
    });
};
