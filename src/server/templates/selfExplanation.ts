import { scriptSchemaWithRoles } from './script';
import type { TemplateDefinition } from './types';

const roles = ['setup', 'prompt', 'reflect', 'check'] as const;

export const selfExplanation: TemplateDefinition = {
    key: 'self-explanation',
    version: 1,
    name: 'Self-explanation prompt',
    promptFragment: [
        'Show the shortest correct procedure for the concept, then stop after each decisive step and ask why that step is allowed and what it buys.',
        'The learner must answer in their own words; do not supply the explanation inside the same step, only the question.',
        'Keep the procedure in front of the learner while asking, so that the task is explaining and not recalling.',
        'The success criterion names the causal link the learner has to produce, not its wording.',
    ].join(' '),
    roles,
    scriptSchema: scriptSchemaWithRoles(roles),
};
