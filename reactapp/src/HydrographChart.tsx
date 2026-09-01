// reactapp/src/HydrographChart.tsx
// FE5's centerpiece: the event hydrograph, read from the ACTUAL .bdy file a
// run produced (what you see is literally what LISFLOOD-FP consumes). The
// echarts bundle is heavy, so the chart lazy-loads; parsing happens here.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { getStepRunOutputs, type ServerStepRun } from './api';
import { parseBdy, type Series } from './bdy';

const ReactECharts = lazy(() => import('echarts-for-react'));

export default function HydrographChart({ run }: { run: ServerStepRun }) {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startMs = useMemo(() => {
    const s = run.config?.start_dt;
    const t = typeof s === 'string' ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? t : null;
  }, [run.config]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { outputs } = await getStepRunOutputs(run.id);
        const bdy = outputs.find((o) => o.name.toLowerCase().endsWith('.bdy'));
        if (!bdy?.url) throw new Error('no .bdy in outputs');
        const text = await (await fetch(bdy.url)).text();
        const parsed = parseBdy(text, startMs);
        if (!parsed.length) throw new Error('no readable series in the .bdy');
        if (alive) setSeries(parsed);
      } catch (e) {
        if (alive) setError(String((e as Error).message ?? e));
      }
    })();
    return () => { alive = false; };
  }, [run.id, startMs]);

  if (error) return <span className="sp-muted">hydrograph unavailable ({error})</span>;
  if (!series) return <span className="sp-muted">loading hydrograph…</span>;

  const s0 = series[0];
  const peak = s0.points.reduce((a, b) => (b[1] > a[1] ? b : a));
  const durationH = (s0.points[s0.points.length - 1][0] - s0.points[0][0]) / 3.6e6;

  const option = {
    animation: false,
    grid: { left: 60, right: 24, top: 30, bottom: 42 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: number) => `${Number(v).toFixed(2)} m³/s`,
    },
    xAxis: {
      type: startMs !== null ? 'time' : 'value',
      name: startMs !== null ? '' : 'hours',
      axisLabel: startMs === null
        ? { formatter: (v: number) => `${(v / 3.6e6).toFixed(0)} h` }
        : undefined,
    },
    yAxis: {
      type: 'value',
      name: 'discharge (m³/s)',
      nameTextStyle: { color: '#28899D' },
    },
    series: series.map((s) => ({
      name: s.boundary,
      type: 'line',
      data: s.points,
      showSymbol: false,
      lineStyle: { color: '#123458', width: 2 },
      areaStyle: { color: 'rgba(37, 194, 223, 0.25)' },
      markPoint: {
        data: [{ coord: peak, name: 'peak' }],
        symbolSize: 44,
        itemStyle: { color: '#25C2DF' },
        label: {
          formatter: () => `${peak[1].toFixed(1)}`,
          color: '#152428', fontSize: 10,
        },
      },
    })),
  };

  return (
    <div className="hg-wrap">
      <Suspense fallback={<span className="sp-muted">loading chart…</span>}>
        <ReactECharts option={option} style={{ height: 230 }} notMerge />
      </Suspense>
      <span className="sp-muted">
        {s0.boundary} · peak {peak[1].toFixed(1)} m³/s · {durationH.toFixed(0)} h event
        {startMs !== null && ` from ${new Date(s0.points[0][0]).toLocaleString()}`}
        {' '}— the simulation runs this exact series.
      </span>
    </div>
  );
}
