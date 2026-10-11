import type { Step as JoyrideStep } from 'react-joyride';
import type { useTranslations } from 'next-intl';

export type TourTranslator = ReturnType<typeof useTranslations<'Tour'>>;

export type TourStepFactory = (t: TourTranslator, completedActions: Set<string>) => JoyrideStep[];

export const TOUR_STEPS_BY_PATH: Record<string, TourStepFactory> = {};

export function getStepsForPage(t: TourTranslator, pathname: string, completedActions?: string[]): JoyrideStep[] {
    const factory = TOUR_STEPS_BY_PATH[pathname];
    return factory ? factory(t, new Set(completedActions ?? [])) : [];
}
