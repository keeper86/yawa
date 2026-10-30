import { contrastingCases } from './contrastingCases';
import { predictObserveExplain } from './predictObserveExplain';
import { retrievalPractice } from './retrievalPractice';
import { selfExplanation } from './selfExplanation';
import type { TemplateDefinition, TemplateKey } from './types';
import { workedExample } from './workedExample';

export { baseScriptSchema, type Script, scriptSchemaWithRoles } from './script';
export type { TemplateDefinition, TemplateKey } from './types';

export const templateDefinitions: readonly TemplateDefinition[] = [
    workedExample,
    selfExplanation,
    contrastingCases,
    predictObserveExplain,
    retrievalPractice,
];

export const templateId = (key: string, version: number) => `${key}@${version}`;

const registry = new Map(
    templateDefinitions.map((definition) => [templateId(definition.key, definition.version), definition]),
);

export const getTemplateDefinition = (key: string, version: number) => registry.get(templateId(key, version));

export const getActiveDefinition = (key: TemplateKey) => {
    const candidates = templateDefinitions.filter((definition) => definition.key === key);
    return candidates.sort((left, right) => right.version - left.version)[0];
};
