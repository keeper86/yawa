import { scriptSchemaWithRoles } from './script';
import type { TemplateDefinition } from './types';

export const workedExample: TemplateDefinition = {
    key: 'worked-example',
    version: 1,
    name: 'Worked example with faded practice',
    promptFragment: [
        'Open with the problem in the terms the audience already knows, then solve it completely, naming the reason for every step.',
        'After the complete solution, present a problem of the same kind and hand one more step to the learner each time.',
        'The last step must be solved by the learner alone, and the success criterion must state what a correct last step looks like.',
        'Never introduce a second concept. If the solution needs another idea, name it as a prerequisite instead of explaining it.',
    ].join(' '),
    scriptSchema: scriptSchemaWithRoles(['setup', 'model', 'fade', 'check']),
};
