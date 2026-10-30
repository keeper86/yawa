import { scriptSchemaWithRoles } from './script';
import type { TemplateDefinition } from './types';

const roles = ['prompt', 'recall', 'check'] as const;

export const retrievalPractice: TemplateDefinition = {
    key: 'retrieval-practice',
    version: 1,
    name: 'Retrieval practice',
    promptFragment: [
        'Ask a question that can only be answered from memory and contains no hint about the answer.',
        'Do not teach before the attempt. The learner answers first, then the answer is confirmed against the source.',
        'If the attempt fails, give a short correction and ask the same question again in a different formulation.',
        'The success criterion names what a complete answer contains, so that a partial answer is scored partially.',
    ].join(' '),
    roles,
    scriptSchema: scriptSchemaWithRoles(roles),
};
