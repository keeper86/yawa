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

type Row = { x: number; [key: string]: number };

const toRows = (figure: Figure): Row[] => {
    const xs = [...new Set(figure.series.flatMap((series) => series.points.map((point) => point.x)))].sort(
        (a, b) => a - b,
    );

    return xs.map((x) => {
        const row: Row = { x };
        figure.series.forEach((series, index) => {
            const point = series.points.find((entry) => entry.x === x);
            if (point) {
                row[`series${index}`] = point.y;
            }
        });
        return row;
    });
};

export const LessonFigure = ({ figure }: { figure: Figure }) => {
    const t = useTranslations('Charts');
    const [override, setOverride] = useState<AxisScale | null>(null);

    const rows = useMemo(() => toRows(figure), [figure]);
    const xValues = useMemo(() => rows.map((row) => row.x), [rows]);
    const yValues = useMemo(() => figure.series.flatMap((series) => series.points.map((point) => point.y)), [figure]);

    const allowLog = figure.template !== 'compare';
    const plan = useMemo(() => planAxis(yValues, { allowLog }), [yValues, allowLog]);
    const scale: AxisScale = override ?? plan.scale;
    const yAxis = useMemo(() => axisForScale(yValues, scale), [yValues, scale]);
    const xOnLog = scale === 'log' && allowLog && xValues.every((value) => value > 0);
    const xAxis = useMemo(
        () => (xOnLog ? axisForScale(xValues, 'log') : { domain: linearDomain(xValues), ticks: null }),
        [xOnLog, xValues],
    );

    const multiple = figure.series.length > 1;

    const axisElements = () => [
        <CartesianGrid key='grid' stroke='var(--border)' strokeDasharray='3 3' />,
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
        />,
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
            labelFormatter={(value: number) => `${axisTitle(figure.x)}: ${formatTick(value)}`}
        />,
        ...(multiple ? [<Legend key='legend' wrapperStyle={{ fontSize: 11 }} />] : []),
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
                            {axisElements()}
                            {figure.series.map((series, index) => (
                                <Bar
                                    dataKey={`series${index}`}
                                    fill={COLOURS[index]}
                                    key={series.label}
                                    name={series.label}
                                />
                            ))}
                        </BarChart>
                    ) : figure.template === 'scatter' ? (
                        <ScatterChart>
                            {axisElements()}
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
                            {axisElements()}
                            {figure.series.map((series, index) => (
                                <Line
                                    dataKey={`series${index}`}
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
