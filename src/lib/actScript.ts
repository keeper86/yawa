import { createHash } from 'node:crypto';

type ScriptLike = {
    steps: { text: string }[];
};

export const actText = (act: { title: string; script: ScriptLike }): string =>
    [act.title.trim(), ...act.script.steps.map((step) => step.text.trim())].join('\n');

export const actContentHash = (text: string, templateKey: string, templateVersion: number): string =>
    createHash('sha256').update(`${templateKey}@${templateVersion}\n${text}`).digest('hex');
