import type { Tables } from '@/types/db_schemas';
import type { ActOrigin } from '@/types/enums';
import type { AiProvider } from '../ai';
import type { Knex } from 'knex';
import { actsInClosure, conceptHops } from './expand';
import { type Diagnosis, GRAPH_SEED, type ScoreComponents, scoreComponents, totalScore } from './rank';
import { fuseRankings, lexicalSeed, vectorSeed } from './seed';

export type RetrievalRequest = {
    viewerUserId: string;
    goalConceptId: string;
    query: string;
    diagnosis: Diagnosis;
};

export type RetrievalCandidate = {
    actId: string;
    conceptId: string;
    templateKey: string;
    hop: number | null;
    via: 'vector' | 'lexical' | 'graph';
    score: number;
    components: ScoreComponents;
};

export type RetrievalResult = {
    candidates: RetrievalCandidate[];
    snapshot: {
        query: string;
        vectorSeeds: string[];
        lexicalSeeds: string[];
        closure: { conceptId: string; hop: number }[];
        graphOnlySeeds: string[];
        excludedWithoutEmbedding: number;
    };
};

type ActRow = {
    id: string;
    concept_id: string;
    templateKey: string;
    origin: ActOrigin;
    uses: string | number | null;
    meanOutcome: number | null;
};

const TOP_N = 10;

export const topCandidates = (candidates: RetrievalCandidate[], limit = TOP_N) => candidates.slice(0, limit);

export const retrieve = async (
    db: Knex<Tables>,
    ai: AiProvider,
    request: RetrievalRequest,
): Promise<RetrievalResult> => {
    const [queryVector] = await ai.embed([request.query]);
    const [vectorHits, lexicalHits] = await Promise.all([
        vectorSeed(db, queryVector, request.viewerUserId),
        lexicalSeed(db, request.query, request.viewerUserId),
    ]);
    const fused = fuseRankings([vectorHits, lexicalHits]);

    const hops = await conceptHops(db, request.goalConceptId);
    const inClosure = await actsInClosure(db, hops, request.viewerUserId);
    const hopByAct = new Map(inClosure.map((entry) => [entry.actId, entry.hop]));

    const candidateIds = [...new Set([...fused.keys(), ...hopByAct.keys()])];
    const graphOnly = [...hopByAct.keys()].filter((actId) => !fused.has(actId));
    if (candidateIds.length === 0) {
        return {
            candidates: [],
            snapshot: {
                query: request.query,
                vectorSeeds: vectorHits,
                lexicalSeeds: lexicalHits,
                closure: [...hops].map(([conceptId, hop]) => ({ conceptId, hop })),
                graphOnlySeeds: [],
                excludedWithoutEmbedding: 0,
            },
        };
    }

    const rows = (await db('acts')
        .join('templates', 'templates.id', 'acts.template_id')
        .leftJoin('act_template_quality as quality', function joinQuality() {
            this.on('quality.concept_id', 'acts.concept_id').andOn('quality.template_id', 'acts.template_id');
        })
        .whereIn('acts.id', candidateIds)
        .select(
            'acts.id',
            'acts.concept_id',
            'acts.origin',
            'templates.key as templateKey',
            'quality.uses as uses',
            'quality.mean_outcome as meanOutcome',
        )) as ActRow[];

    const candidates = rows
        .filter((row) => hops.has(row.concept_id))
        .map((row) => {
            const hop = hopByAct.get(row.id) ?? null;
            const components = scoreComponents({
                seed: fused.get(row.id) ?? GRAPH_SEED,
                origin: row.origin,
                templateKey: row.templateKey,
                uses: Number(row.uses ?? 0),
                meanOutcome: row.meanOutcome === null ? null : Number(row.meanOutcome),
                hop,
                diagnosis: request.diagnosis,
            });

            const via = hop === null ? (vectorHits.includes(row.id) ? 'vector' : 'lexical') : 'graph';

            return {
                actId: row.id,
                conceptId: row.concept_id,
                templateKey: row.templateKey,
                hop,
                via,
                score: totalScore(components),
                components,
            } satisfies RetrievalCandidate;
        })
        .sort((left, right) => right.score - left.score);

    const withoutEmbedding = await db('acts')
        .whereNull('acts.embedding')
        .where((builder) =>
            builder.whereNotNull('acts.published_at').orWhere('acts.owner_user_id', request.viewerUserId),
        )
        .count<{ count: string }>('* as count')
        .first();

    return {
        candidates,
        snapshot: {
            query: request.query,
            vectorSeeds: vectorHits,
            lexicalSeeds: lexicalHits,
            closure: [...hops].map(([conceptId, hop]) => ({ conceptId, hop })),
            graphOnlySeeds: graphOnly,
            excludedWithoutEmbedding: Number(withoutEmbedding?.count ?? 0),
        },
    };
};
