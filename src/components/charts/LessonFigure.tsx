'use client';

import type { Figure } from '@/lib/lesson';
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

const COLOURS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'];

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' };

const tick = (value: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(value);

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
    const rows = toRows(figure);
    const multiple = figure.series.length > 1;

    const axes = (
        <>
            <CartesianGrid className='stroke-border' strokeDasharray='3 3' />
            <XAxis
                dataKey='x'
                height={44}
                label={{ value: figure.xLabel, position: 'insideBottom', offset: -2, fontSize: 11 }}
                tick={AXIS_TICK}
                tickFormatter={tick}
                type='number'
            />
            <YAxis
                label={{ value: figure.yLabel, angle: -90, position: 'insideLeft', fontSize: 11 }}
                tick={AXIS_TICK}
                tickFormatter={tick}
                type='number'
                width={64}
            />
            <Tooltip
                formatter={(value: number) => tick(value)}
                labelFormatter={(value: number) => `${figure.xLabel}: ${tick(value)}`}
            />
            {multiple ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        </>
    );

    return (
        <figure className='space-y-1'>
            <div className='h-56 w-full'>
                <ResponsiveContainer height='100%' width='100%'>
                    {figure.kind === 'bar' ? (
                        <BarChart data={rows}>
                            {axes}
                            {figure.series.map((series, index) => (
                                <Bar
                                    dataKey={`series${index}`}
                                    fill={COLOURS[index]}
                                    key={series.label}
                                    name={series.label}
                                />
                            ))}
                        </BarChart>
                    ) : figure.kind === 'scatter' ? (
                        <ScatterChart>
                            {axes}
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
                            {axes}
                            {figure.series.map((series, index) => (
                                <Line
                                    dataKey={`series${index}`}
                                    dot={false}
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
