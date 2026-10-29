import knex from 'knex';
import config from '../knexfile';
import { loadCorpus, seedCorpus } from '../src/server/eval/corpus';
import { briefSchema } from '../src/lib/lectureBrief';

const DEMO_TITLE = 'Numerische Integration (Demo)';

const database = knex(config.development);

const pickOwner = async (requested: string | null): Promise<string> => {
    if (requested !== null) {
        return requested;
    }
    const row = await database('user_data').orderBy('user_id').first();
    if (!row) {
        throw new Error('No user_data row exists. Run npm run db:seed first.');
    }
    return row.user_id;
};

const run = async () => {
    const ownerUserId = await pickOwner(process.argv[2] ?? null);
    const corpus = loadCorpus();

    const result = await seedCorpus(database, { ownerUserId, corpus, actStatus: 'proposed', publish: false });

    const conceptIds = await database('concepts')
        .whereIn(
            'slug',
            corpus.concepts.map((entry) => entry.slug),
        )
        .pluck('id');
    const sourceId = (
        await database('sources').where({ external_id: corpus.source.externalId }).first()
    )?.id;
    const acts = await database('acts')
        .whereIn(
            'concept_id',
            conceptIds,
        )
        .where({ origin: 'authored' })
        .orderBy('created_at');

    const brief = briefSchema.parse({
        audience: 'B.Sc. Physik, 3. Semester',
        objectives: [
            {
                concept: 'trapezregel',
                verb: 'apply',
                depth: 'ein Integral ueber zwei Intervalle mit der Trapezregel von Hand berechnen',
            },
        ],
        mustCover: ['trapezregel', 'simpsonregel'],
        mustAvoid: [],
        durationMinutes: 45,
        tone: 'formal',
        language: corpus.language,
        notes: 'Riemannsummen sind bekannt, Interpolation nicht.',
    });

    const existing = await database('lectures').where({ owner_user_id: ownerUserId, title: DEMO_TITLE }).first();
    const lecture =
        existing ??
        (
            await database('lectures')
                .insert({
                    owner_user_id: ownerUserId,
                    title: DEMO_TITLE,
                    abstract: 'Demo-Vorlesung aus dem Golden Corpus.',
                    language: corpus.language,
                    brief,
                })
                .returning('*')
        )[0];

    if (!existing) {
        await database('lecture_concepts').insert(
            conceptIds.map((conceptId) => ({ lecture_id: lecture.id, concept_id: conceptId })),
        );
        if (sourceId) {
            await database('lecture_sources').insert({ lecture_id: lecture.id, source_id: sourceId });
        }
    }

    const reset = await database('acts')
        .whereIn(
            'id',
            acts.map((act) => act.id),
        )
        .whereNot({ status: 'proposed' })
        .update({ status: 'proposed', published_at: null });
    if (reset > 0) {
        console.log(`Reset ${reset} corpus acts to proposed so the review queue has work.`);
    }

    const existingLinks = await database('lecture_acts').where({ lecture_id: lecture.id }).pluck('act_id');
    const missing = acts.filter((act) => !existingLinks.includes(act.id));
    if (missing.length > 0) {
        const offset = existingLinks.length;
        await database('lecture_acts').insert(
            missing.map((act, index) => ({ lecture_id: lecture.id, act_id: act.id, position: offset + index })),
        );
    }

    console.log('Corpus seeded:', result);
    console.log(`Lecture: ${lecture.id} (${DEMO_TITLE}), owner ${ownerUserId}`);
    console.log(`Acts in lecture: ${existingLinks.length + missing.length}, all proposed -> review queue has work.`);
    console.log('Open /lectures and click the lecture.');
};

run()
    .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => database.destroy());
