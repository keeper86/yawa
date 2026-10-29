import { scriptSchemaWithRoles } from './script';
import type { TemplateDefinition } from './types';

export const contrastingCases: TemplateDefinition = {
    key: 'contrasting-cases',
    version: 1,
    name: 'Contrasting cases',
    promptFragment: [
        'Present two cases that are as similar as possible except for the one feature that decides the difference.',
        'Do not name the discriminating feature; ask the learner to describe what differs and what it changes.',
        'After the learner answers, confirm or correct the feature explicitly and show what would happen if the cases were swapped.',
        'The success criterion names the discriminating feature and the consequence of getting it wrong.',
    ].join(' '),
    scriptSchema: scriptSchemaWithRoles(['setup', 'show', 'compare', 'conclude']),
};
