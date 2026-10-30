import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConcept } from '@/server/concept/resolve';
import { getAi } from '@/server/ai';
import { planLecture, runCreationJob } from '@/server/agent/jobs';
import { getDb, testUsers } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';

const ENABLED = process.env.AGENT_SMOKE === '1';
const owner = testUsers.testUser.user_id;

const fixture = (name: string) => JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/wiki', name), 'utf8'));

const recordedSection = () => fixture('section-2.json').parse.wikitext as string;

const stripForStorage = (wikitext: string) => wikitext;

describe.skipIf(!ENABLED)('creation agent smoke test against the real model', () => {
    it('plans and drafts acts for the recorded Trapezoidal rule passage', async () => {
        const db = getDb();
        const rights = fixture('rightsinfo.json').query.rightsinfo;
        const meta = fixture('page-meta.json').query.pages[0];

        const [source] = await db('sources')
            .insert({
                owner_user_id: null,
                kind: 'wikipedia',
                external_id: `enwiki:${meta.pageid}`,
                title: meta.title,
                language: 'en',
                uri: `https://en.wikipedia.org/w/index.php?oldid=${meta.lastrevid}`,
                license: rights.text,
                license_url: rights.url,
                source_revision: String(meta.lastrevid),
                fetched_at: new Date(),
            })
            .returning('*');

        const [section] = await db('source_sections')
            .insert({
                source_id: source.id,
                position: 0,
                heading: 'Numerical implementation',
                anchor: 'Numerical_implementation',
                content: stripForStorage(recordedSection()),
                content_hash: 'smoke',
            })
            .returning('*');

        const concept = await resolveConcept(db, {
            title: 'Trapezregel',
            language: 'de',
            summary: 'Verfahren der numerischen Integration, das die Fläche durch Trapeze annähert.',
            wikidataQid: null,
            createdByUserId: owner,
        });

        const [lecture] = await db('lectures')
            .insert({
                owner_user_id: owner,
                title: 'Numerische Integration',
                language: 'de',
                brief: {
                    audience: 'B.Sc. Physik, 3. Semester',
                    objectives: [
                        {
                            concept: concept.slug,
                            verb: 'apply',
                            depth: 'ein Integral über zwei Intervalle mit der Trapezregel von Hand berechnen',
                        },
                    ],
                    mustCover: [concept.slug],
                    mustAvoid: [],
                    durationMinutes: 30,
                    tone: 'formal',
                    language: 'de',
                    notes: 'Riemannsummen sind bekannt.',
                },
            })
            .returning('*');

        await db('lecture_concepts').insert({ lecture_id: lecture.id, concept_id: concept.id });
        await db('lecture_sources').insert({ lecture_id: lecture.id, source_id: source.id });

        const job = await planLecture(db, getAi(), { lectureId: lecture.id, userId: owner });
        console.log('PLAN', JSON.stringify(job.plan, null, 2));

        const result = await runCreationJob(db, getAi(), { jobId: job.id, userId: owner, maxUnits: 2 });
        console.log('RESULT', JSON.stringify(result));
        const finishedJob = await db('creation_jobs').where({ id: job.id }).first();
        console.log('JOB', finishedJob?.status, finishedJob?.error);

        const acts = await db('acts').where({ owner_user_id: owner }).orderBy('created_at');
        for (const act of acts) {
            console.log(
                'ACT',
                act.title,
                JSON.stringify(
                    (act.script as { steps: { role: string; text: string }[] }).steps.map(
                        (step) => `${step.role}: ${step.text.slice(0, 120)}`,
                    ),
                    null,
                    1,
                ),
            );
        }

        expect(job.status).toBe('plan_ready');
        expect(job.plan).not.toBeNull();
        expect(result.generated).toBeGreaterThanOrEqual(1);
        expect(acts.length).toBeGreaterThanOrEqual(1);
        expect(section.id).toBeTruthy();
    }, 180_000);
});
