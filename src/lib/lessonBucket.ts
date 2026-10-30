export type MasteryBucket = 'novice' | 'developing' | 'fluent';

export const masteryBucket = (mastery: number): MasteryBucket => {
    if (mastery < 0.4) {
        return 'novice';
    }
    return mastery < 0.75 ? 'developing' : 'fluent';
};
