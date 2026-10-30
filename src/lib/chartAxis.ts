export const LOG_SPREAD_THRESHOLD = 10;
export const LINEAR_PADDING = 0.08;
export const MIN_RELATIVE_SPREAD = 0.02;

export type AxisScale = 'linear' | 'log';

export type LogAxis = {
    domain: [number, number];
    ticks: number[];
};

export type AxisPlan = {
    scale: AxisScale;
    domain: [number, number];
    ticks: number[] | null;
    canSwitch: boolean;
};

const finitePositive = (values: readonly number[]): number[] =>
    values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);

export function logDecadeTicks(lo: number, hi: number): number[] {
    const firstExponent = Math.floor(Math.log10(lo));
    const lastExponent = Math.ceil(Math.log10(hi));
    return Array.from({ length: lastExponent - firstExponent + 1 }, (_, index) => Math.pow(10, firstExponent + index));
}

export function logAxisForRange(lo: number, hi: number): LogAxis {
    const ticks = logDecadeTicks(lo, hi);
    return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] };
}

export function trimmedLogAxis(values: readonly number[]): LogAxis | null {
    const magnitudes = finitePositive(values);
    if (magnitudes.length < 2) {
        return null;
    }

    const candidateLo = magnitudes[2];
    const candidateHi = magnitudes[magnitudes.length - 3];
    const canTrim = candidateLo !== undefined && candidateHi !== undefined && candidateLo < candidateHi;
    const lo = canTrim ? candidateLo : magnitudes[0];
    const hi = canTrim ? candidateHi : magnitudes[magnitudes.length - 1];

    if (hi / lo <= LOG_SPREAD_THRESHOLD) {
        return null;
    }
    return logAxisForRange(lo, hi);
}

export function linearDomain(values: readonly number[]): [number, number] {
    const finite = values.filter((value) => Number.isFinite(value));
    if (finite.length === 0) {
        return [0, 1];
    }

    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    const middle = (lo + hi) / 2;
    const minimumSpread = Math.abs(middle) * MIN_RELATIVE_SPREAD + 0.01;

    if (hi - lo < minimumSpread) {
        return [middle - minimumSpread / 2, middle + minimumSpread / 2];
    }

    const padding = (hi - lo) * LINEAR_PADDING;
    return [lo - padding, hi + padding];
}

export function canUseLog(values: readonly number[]): boolean {
    const finite = values.filter((value) => Number.isFinite(value));
    return finite.length >= 2 && finite.every((value) => value > 0) && trimmedLogAxis(finite) !== null;
}

export function planAxis(values: readonly number[], options: { allowLog: boolean }): AxisPlan {
    const logAxis = options.allowLog ? trimmedLogAxis(values) : null;
    const canSwitch = options.allowLog && values.filter((value) => Number.isFinite(value)).every((value) => value > 0);

    if (logAxis) {
        return { scale: 'log', domain: logAxis.domain, ticks: logAxis.ticks, canSwitch };
    }
    return { scale: 'linear', domain: linearDomain(values), ticks: null, canSwitch };
}

export function axisForScale(
    values: readonly number[],
    scale: AxisScale,
): { domain: [number, number]; ticks: number[] | null } {
    if (scale === 'log') {
        const magnitudes = finitePositive(values);
        if (magnitudes.length >= 2) {
            const axis = logAxisForRange(magnitudes[0], magnitudes[magnitudes.length - 1]);
            return { domain: axis.domain, ticks: axis.ticks };
        }
    }
    return { domain: linearDomain(values), ticks: null };
}
