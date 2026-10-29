'use client';

import { axisForScale, linearDomain, planAxis, type AxisScale } from '@/lib/chartAxis';
import type { Figure, FigureAxis } from '@/lib/lesson';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

const COLOURS = ['var(--chart-1)', 'var(--chart-2)'];

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' };

const formatTick = (value: number) => {
    if (value === 0) {
        return '0';
    }
    const magnitude = Math.abs(value);
    if (magnitude >= 1000 || magnitude < 0.01) {
        return value.toExponential(0).replace('e+', 'e');
    }
    return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(value);
};

const axisTitle = (axis: FigureAxis) => (axis.unit === '1' ? axis.label : `${axis.label} (${axis.unit})`);

const plotValues = (figure: Extract<Figure, { template: 'trend' | 'scatter' }>): number[] =>
    figure.series.flatMap((series) => series.points.map((point) => point.y));

const barValues = (figure: Extract<Figure, { template: 'compare' }>): number[] =>
    figure.series.flatMap((series) => series.values);

const seriesKeys = (count: number) => Array.from({ length: count }, (_, index) => `series${index}`);

export const LessonFigure = ({ figure }: { figure: Figure }) => {
    const t = useTranslations('Charts');
    const [override, setOverride] = useState<AxisScale | null>(null);

    const compare = figure.template === 'compare';
    const values = useMemo(() => (figure.template === 'compare' ? barValues(figure) : plotValues(figure)), [figure]);
    const plotX = useMemo(
        () =>
            figure.template === 'compare'
                ? []
                : [...new Set(figure.series.flatMap((series) => series.points.map((point) => point.x)))].sort(
                      (a, b) => a - b,
                  ),
        [figure],
    );

    const plan = useMemo(() => planAxis(values, { allowLog: !compare }), [values, compare]);
    const scale: AxisScale = override ?? plan.scale;
    const yAxis = useMemo(() => axisForScale(values, scale), [values, scale]);
    const xOnLog = scale === 'log' && !compare && plotX.every((value) => value > 0);
    const xAxis = useMemo(
        () => (xOnLog ? axisForScale(plotX, 'log') : { domain: linearDomain(plotX), ticks: null }),
        [xOnLog, plotX],
    );

    const rows = useMemo(() => {
        if (figure.template === 'compare') {
            return figure.categories.map((category, index) => {
                const row: Record<string, string | number> = { category };
                figure.series.forEach((series, seriesIndex) => {
                    row[seriesKeys(figure.series.length)[seriesIndex]] = series.values[index];
                });
                return row;
            });
        }
        return plotX.map((x) => {
            const row: Record<string, string | number> = { x };
            figure.series.forEach((series, seriesIndex) => {
                const point = series.points.find((entry) => entry.x === x);
                if (point) {
                    row[seriesKeys(figure.series.length)[seriesIndex]] = point.y;
                }
            });
            return row;
        });
    }, [figure, plotX]);

    const baseElements = () => [
        <CartesianGrid key='grid' stroke='var(--border)' strokeDasharray='3 3' />,
        compare ? (
            <XAxis
                dataKey='category'
                interval={0}
                key='x'
                stroke='var(--border)'
                tick={AXIS_TICK}
                tickLine={{ stroke: 'var(--border)' }}
                type='category'
            />
        ) : (
            <XAxis
                dataKey='x'
                domain={xAxis.domain}
                height={44}
                key='x'
                label={{
                    value: axisTitle(figure.x),
                    position: 'insideBottom',
                    offset: -2,
                    fontSize: 11,
                    fill: 'var(--muted-foreground)',
                }}
                scale={xOnLog ? 'log' : 'linear'}
                stroke='var(--border)'
                tick={AXIS_TICK}
                tickFormatter={formatTick}
                tickLine={{ stroke: 'var(--border)' }}
                ticks={xAxis.ticks ?? undefined}
                type='number'
            />
        ),
        <YAxis
            domain={yAxis.domain}
            key='y'
            label={{
                value: axisTitle(figure.y),
                angle: -90,
                position: 'insideLeft',
                fontSize: 11,
                fill: 'var(--muted-foreground)',
            }}
            scale={scale}
            stroke='var(--border)'
            tick={AXIS_TICK}
            tickFormatter={formatTick}
            tickLine={{ stroke: 'var(--border)' }}
            ticks={yAxis.ticks ?? undefined}
            type='number'
            width={64}
        />,
        <Tooltip
            contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', fontSize: 11 }}
            formatter={(value: number) => formatTick(value)}
            key='tooltip'
            labelFormatter={(value: number | string) => (typeof value === 'number' ? formatTick(value) : value)}
        />,
        ...(figure.series.length > 1 ? [<Legend key='legend' wrapperStyle={{ fontSize: 11 }} />] : []),
    ];

    return (
        <figure className='space-y-1'>
            <div className='flex min-h-5 items-center justify-between gap-3'>
                <span className='text-[11px] text-muted-foreground'>{scale === 'log' ? t('logHint') : ''}</span>
                {plan.canSwitch ? (
                    <div className='flex gap-1'>
                        {(['linear', 'log'] as const).map((option) => (
                            <button
                                aria-pressed={scale === option}
                                className={cn(
                                    'rounded border px-2 py-0.5 text-[11px]',
                                    scale === option
                                        ? 'bg-accent font-medium'
                                        : 'text-muted-foreground hover:bg-accent/50',
                                )}
                                key={option}
                                onClick={() => setOverride(option)}
                                type='button'
                            >
                                {t(option)}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>

            <div className='h-56 w-full'>
                <ResponsiveContainer height='100%' width='100%'>
                    {figure.template === 'compare' ? (
                        <BarChart data={rows}>
                            {baseElements()}
                            {figure.series.map((series, index) => (
                                <Bar
                                    dataKey={seriesKeys(figure.series.length)[index]}
                                    fill={COLOURS[index]}
                                    key={series.label}
                                    name={series.label}
                                />
                            ))}
                        </BarChart>
                    ) : figure.template === 'scatter' ? (
                        <ScatterChart>
                            {baseElements()}
                            {figure.series.map((series, index) => (
                                <Scatter
                                    data={series.points}
                                    fill={COLOURS[index]}
                                    key={series.label}
                                    name={series.label}
                                />
                            ))}
                        </ScatterChart>
                    ) : (
                        <LineChart data={rows}>
                            {baseElements()}
                            {figure.series.map((series, index) => (
                                <Line
                                    dataKey={seriesKeys(figure.series.length)[index]}
                                    dot={{ r: 3 }}
                                    key={series.label}
                                    name={series.label}
                                    stroke={COLOURS[index]}
                                    strokeWidth={2}
                                    type='monotone'
                                />
                            ))}
                        </LineChart>
                    )}
                </ResponsiveContainer>
            </div>
            <figcaption className='text-xs text-muted-foreground'>{figure.caption}</figcaption>
        </figure>
    );
};
