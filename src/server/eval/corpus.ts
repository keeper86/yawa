import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Tables } from '@/types/db_schemas';
import type { Knex } from 'knex';
import { actContentHash, actText } from '@/lib/actScript';
import { resolveConcept } from '../concept/resolve';
import { linkConcepts } from '../graph/relations';
import { getTemplateDefinition, type Script } from '../templates';

export type Corpus = {
    language: string;
    source: {
        externalId: string;
        title: string;
        license: string;
        sections: { heading: string; content: string }[];
    };
    concepts: { slug: string; title: string; summary: string }[];
    relations: [string, string, 'requires' | 'contrasts_with'][];
    acts: {
        concept: string;
        template: string;
        section: number;
        title: string;
        steps: [string, string][];
        success: string;
    }[];
};

export type SeedResult = {
    concepts: number;
    relations: number;
    acts: number;
    sections: number;
};

export type SeedOptions = {
    ownerUserId: string;
    corpus?: Corpus;
    actStatus?: 'proposed' | 'accepted';
    publish?: boolean;
};

export const loadCorpus = (): Corpus =>
    JSON.parse(readFileSync(join(process.cwd(), 'seeds/data/golden_corpus.json'), 'utf8')) as Corpus;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const seedCorpus = async (db: Knex<Tables>, options: SeedOptions): Promise<SeedResult> => {
    const corpus = options.corpus ?? loadCorpus();

    const [source] = await db('sources')
        .insert({
            owner_user_id: null,
            kind: 'paste',
            external_id: corpus.source.externalId,
            title: corpus.source.title,
            language: corpus.language,
            license: corpus.source.license,
        })
        .onConflict()
        .ignore()
        .returning('*');

    const stored =
        source ??
        (await db('sources').where({ external_id: corpus.source.externalId }).whereNull('owner_user_id').first());

    const existingSections = await db('source_sections').where({ source_id: stored.id });
    if (existingSections.length === 0) {
        await db('source_sections').insert(
            corpus.source.sections.map((section, position) => ({
                source_id: stored.id,
                position,
                heading: section.heading,
                anchor: null,
                content: section.content,
                content_hash: hash(section.content),
            })),
        );
    }
    const sections = await db('source_sections').where({ source_id: stored.id }).orderBy('position');

    const conceptIds = new Map<string, string>();
    for (const entry of corpus.concepts) {
        const concept = await resolveConcept(db, {
            title: entry.title,
            language: corpus.language,
            summary: entry.summary,
            wikidataQid: null,
            createdByUserId: options.ownerUserId,
        });
        conceptIds.set(entry.slug, concept.id);
    }

    let relations = 0;
    for (const [from, to, type] of corpus.relations) {
        const sourceConceptId = conceptIds.get(from);
        const targetConceptId = conceptIds.get(to);
        if (!sourceConceptId || !targetConceptId) {
            throw new Error(`Corpus relation ${from} -> ${to} names an unknown concept`);
        }
        const result = await linkConcepts(db, {
            sourceConceptId,
            targetConceptId,
            type,
            status: 'published',
            createdByUserId: options.ownerUserId,
        });
        relations += result.created ? 1 : 0;
    }

    let acts = 0;
    for (const entry of corpus.acts) {
        const conceptId = conceptIds.get(entry.concept);
        if (!conceptId) {
            throw new Error(`Corpus act ${entry.title} names an unknown concept`);
        }
        const template = await db('templates').where({ key: entry.template, version: 1 }).first();
        if (!template) {
            throw new Error(`Corpus act ${entry.title} names an unknown template`);
        }
        const definition = getTemplateDefinition(entry.template, 1);
        if (!definition) {
            throw new Error(`No registry entry for ${entry.template}`);
        }

        const script: Script = {
            steps: entry.steps.map(([role, text]) => ({ role, text })),
            success: { criterion: entry.success },
        };
        const parsed = definition.scriptSchema.safeParse(script);
        if (!parsed.success) {
            throw new Error(`Corpus act ${entry.title} does not match ${entry.template}: ${parsed.error.message}`);
        }

        const text = actText({ title: entry.title, script });
        const contentHash = actContentHash(text, template.key, template.version);
        const existing = await db('acts').where({ content_hash: contentHash }).first();
        if (existing) {
            continue;
        }

        const [act] = await db('acts')
            .insert({
                concept_id: conceptId,
                template_id: template.id,
                template_version: template.version,
                owner_user_id: options.ownerUserId,
                origin: 'authored',
                status: options.actStatus ?? 'accepted',
                published_at: options.publish === false ? null : new Date(),
                title: entry.title,
                script,
                script_text: text,
                content_hash: contentHash,
            })
            .returning('*');

        await db('act_grounding').insert({ act_id: act.id, source_section_id: sections[entry.section].id });
        acts += 1;
    }

    return { concepts: conceptIds.size, relations, acts, sections: sections.length };
};
