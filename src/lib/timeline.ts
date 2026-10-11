export const START_YEAR = 2200;
export const TICKS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * MONTHS_PER_YEAR;

export type TimelineDate = {
    year: number;
    monthIndex: number;
    day: number;
};

export const tickToDate = (tick: number): TimelineDate => {
    const simTick = tick - 1;

    const year = Math.floor(simTick / TICKS_PER_YEAR) + START_YEAR;
    const tickWithinYear = simTick % TICKS_PER_YEAR;
    const monthIndex = Math.floor(tickWithinYear / TICKS_PER_MONTH);
    const day = (tickWithinYear % TICKS_PER_MONTH) + 1;

    return { year, monthIndex, day };
};
