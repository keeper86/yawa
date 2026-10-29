import { scriptSchemaWithRoles } from './script';
import type { TemplateDefinition } from './types';

export const predictObserveExplain: TemplateDefinition = {
    key: 'predict-observe-explain',
    version: 1,
    name: 'Predict, observe, explain',
    promptFragment: [
        'State a concrete situation whose outcome can be computed or plotted, and ask for a prediction with a reason before showing anything.',
        'Then show the outcome, computed step by step or described numerically, without commentary.',
        'Ask the learner to reconcile prediction and outcome; if they agree, ask what would have to change for the other outcome to occur.',
        'The success criterion names the relation between the situation and the outcome, not the prediction itself.',
    ].join(' '),
    scriptSchema: scriptSchemaWithRoles(['setup', 'predict', 'observe', 'explain']),
};
