import { templateStatusSchema } from '@/types/enums';
import { constraintEnumValues } from 'tests/vitest/enumConstraint';
import { getDb } from 'tests/vitest/setupTestcontainer';
import { describe, expect, it } from 'vitest';
import { getTemplateDefinition, templateDefinitions, templateId } from './index';
import type { TemplateKey } from './types';

const definition = (key: TemplateKey) => {
    const found = getTemplateDefinition(key, 1);
    if (!found) {
        throw new Error(`No definition for ${key}@1`);
    }
    return found;
};

const workedExampleScript = {
    steps: [
        { role: 'setup', text: 'Gesucht ist das Integral von x^2 ueber [0, 1].' },
        { role: 'model', text: 'Wir zerlegen das Intervall in zwei Trapeze und setzen die Stuetzstellen ein.' },
        { role: 'fade', text: 'Jetzt der zweite Trapezschritt: welcher Term fehlt noch?' },
        { role: 'check', text: 'Berechne den Wert des zweiten Trapezes allein.' },
    ],
    success: { criterion: 'Der zweite Trapezterm ist vollstaendig und korrekt ausgerechnet.' },
};

describe('template registry', () => {
    it('has exactly one definition per active row and no orphan definitions', async () => {
        const rows = await getDb()('templates').where({ status: 'active' });
        expect(rows.length).toBeGreaterThan(0);

        const fromDatabase = rows.map((row) => `${row.key}@${row.version}`).sort();
        const fromCode = templateDefinitions.map((item) => templateId(item.key, item.version)).sort();

        expect(fromCode).toEqual(fromDatabase);
    });

    it('agrees with the database on names, brief fields and rubrics', async () => {
        for (const item of templateDefinitions) {
            const row = await getDb()('templates').where({ key: item.key, version: item.version }).first();

            expect(row).toBeDefined();
            expect(row?.name).toBe(item.name);
            expect(row?.brief_fields.length).toBeGreaterThan(0);
            expect(row?.rubric.length).toBeGreaterThan(0);
            expect(item.promptFragment.length).toBeGreaterThan(80);
        }
    });

    it('keeps the status enum in sync with the check constraint', async () => {
        expect(await constraintEnumValues('templates', 'status')).toEqual([...templateStatusSchema.options].sort());
    });

    it('accepts a well formed script', () => {
        expect(definition('worked-example').scriptSchema.safeParse(workedExampleScript).success).toBe(true);
    });

    it('rejects a script without a success criterion', () => {
        const { success: _success, ...withoutSuccess } = workedExampleScript;
        expect(definition('worked-example').scriptSchema.safeParse(withoutSuccess).success).toBe(false);
    });

    it('rejects fewer than three and more than eight steps', () => {
        const schema = definition('worked-example').scriptSchema;
        const oneStep = { steps: [workedExampleScript.steps[0]], success: workedExampleScript.success };
        const nineSteps = {
            steps: Array.from({ length: 9 }, () => ({ role: 'model', text: 'Schritt.' })),
            success: workedExampleScript.success,
        };

        expect(schema.safeParse(oneStep).success).toBe(false);
        expect(schema.safeParse(nineSteps).success).toBe(false);
    });

    it('rejects a role the template does not define', () => {
        const wrongRole = {
            ...workedExampleScript,
            steps: workedExampleScript.steps.map((step) => ({ ...step, role: 'observe' })),
        };

        expect(definition('worked-example').scriptSchema.safeParse(wrongRole).success).toBe(false);
    });

    it('refuses a second active version of the same key', async () => {
        await expect(
            getDb()('templates').insert({
                key: 'worked-example',
                version: 2,
                name: 'Second active version',
                intent: 'should not be inserted',
                trigger: 'never',
                brief_fields: [],
                rubric: [],
                status: 'active',
            }),
        ).rejects.toMatchObject({ code: '23505' });
    });
});
