import { defaultLocale, getDecimalSeparator, type Locale } from '@/i18n/config';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import de from '../i18n/messages/de.json';
import en from '../i18n/messages/en.json';

const catalogs = { en, de } as const;

const EPSILON = 1e-3;

export function formatNumbers(n: number | null | undefined, decimalSeparator = '.'): string {
    if (n == null || !isFinite(n)) {
        return '—';
    }
    if (Math.abs(n) < EPSILON) {
        if (n === 0) {
            return '0';
        }
        return '<' + String(EPSILON).replace('.', decimalSeparator);
    }

    let currentNumber = n;
    let currentSuffix = '';
    const abbreviations: [number, string][] = [
        [1_000_000_000_000_000_000_000, 'Z'],
        [1_000_000_000_000_000_000, 'E'],
        [1_000_000_000_000_000, 'P'],
        [1_000_000_000_000, 'T'],
        [1_000_000_000, 'B'],
        [1_000_000, 'M'],
        [1_000, 'k'],
    ];
    for (const [value, suffix] of abbreviations) {
        if (Math.abs(n) * 1.05 >= value) {
            currentSuffix = suffix;
            currentNumber = n / value;
            break;
        }
    }

    const leadingWithZero = Math.trunc(currentNumber) === 0;
    const formatted = currentNumber.toPrecision(leadingWithZero ? 2 : 3);

    return (
        formatted
            .replace(/(\.\d*?[1-9])0+$/u, '$1')
            .replace(/\.0+$/u, '')
            .replace(/\.$/u, '')
            .replace('.', decimalSeparator) + currentSuffix
    );
}

const dayWord = (locale: Locale, count: number | null | undefined): string => {
    const units = catalogs[locale].Units;
    return count === 1 ? units.day : units.days;
};

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type Units = 'tonnes' | 'litres' | 'units' | 'persons' | 'percent' | 'm3' | 'days' | 'none';

export const formatNumberWithUnit = (n: number | null | undefined, unit: Units, locale: Locale): string => {
    const formattedNumber = formatNumbers(n, getDecimalSeparator(locale));
    if (formattedNumber === '—') {
        return formattedNumber;
    }
    if (unit === 'tonnes') {
        return `${formattedNumber}t`;
    }
    if (unit === 'litres') {
        return `${formattedNumber}ℓ`;
    }
    if (unit === 'm3') {
        return `${formattedNumber}(m³)`;
    }
    if (unit === 'percent') {
        return `${formattedNumber}%`;
    }
    if (unit === 'days') {
        return `${formattedNumber} ${dayWord(locale, n)}`;
    }

    return formattedNumber;
};

export function formatWallTime(ms: number, short = false, locale: Locale = defaultLocale): string {
    const units = catalogs[locale].Units;
    const decimalSeparator = getDecimalSeparator(locale);
    if (ms < 1000) {
        return units.lessThanOneSecond;
    }
    const totalSeconds = Math.round(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let result = '';
    if (days > 0) {
        result += `${days}${units.daysShort} `;
        if (short) {
            return `${(totalSeconds / 86400).toFixed(1).replace('.', decimalSeparator)}${units.daysShort}`;
        }
    }
    if (hours > 0) {
        result += `${hours}${units.hoursShort} `;
        if (short) {
            return `${(totalSeconds / 3600).toFixed(1).replace('.', decimalSeparator)}${units.hoursShort}`;
        }
    }
    if (minutes > 0) {
        result += `${minutes}${units.minutesShort} `;
        if (short) {
            return `${(totalSeconds / 60).toFixed(1).replace('.', decimalSeparator)}${units.minutesShort}`;
        }
    }
    if (seconds > 0) {
        result += `${seconds}${units.secondsShort} `;
    }
    return result.slice(0, -1);
}
