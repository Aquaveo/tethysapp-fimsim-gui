// reactapp/src/HydrographChart.tsx
// FE5's centerpiece: the event hydrograph, read from the ACTUAL .bdy file a
// run produced (what you see is literally what LISFLOOD-FP consumes). The
// echarts bundle is heavy, so the chart lazy-loads; parsing happens here.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { getStepRunOutputs, type ServerStepRun } from './api';
import { parseBdy, parseDischargeCsv, type Series } from './bdy';
import { fileProxyUrl } from './outputsMeta';

const ReactECharts = lazy(() => import('echarts-for-react'));

export default function HydrographChart({ run }: { run: ServerStepRun }) {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [unit, setUnit] = useState<'m³/s' | 'm²/s'>('m³/s');
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
        // Prefer the raw NWM/gage CSV: true discharge in m³/s. The .bdy holds
        // LISFLOOD's per-metre-width inflow (Q ÷ cell width) — correct for
        // the solver, misleading as "discharge".
        // same-origin proxy: presigned MinIO URLs are CORS-hostile to fetch()
        const csv = outputs.find((o) => /discharge.*\.csv$/i.test(o.name));
        if (csv) {
          const parsed = parseDischargeCsv(
            await (await fetch(fileProxyUrl(run.id, csv.name))).text());
          if (parsed.length) {
            if (alive) { setSeries(parsed); setUnit('m³/s'); }
            return;
          }
        }
        const bdy = outputs.find((o) => o.name.toLowerCase().endsWith('.bdy'));
        if (!bdy) throw new Error('no .bdy in outputs');
        const text = await (await fetch(fileProxyUrl(run.id, bdy.name))).text();
        const parsed = parseBdy(text, startMs);
        if (!parsed.length) throw new Error('no readable series in the .bdy');
        if (alive) { setSeries(parsed); setUnit('m²/s'); }
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
      valueFormatter: (v: number) => `${Number(v).toFixed(2)} ${unit}`,
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
      name: unit === 'm³/s' ? 'discharge (m³/s)'
        : 'inflow per metre width (m²/s)',
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
        {s0.boundary} · peak {peak[1].toFixed(1)} {unit} · {durationH.toFixed(0)} h event
        {startMs !== null && ` from ${new Date(s0.points[0][0]).toLocaleString()}`}
        {unit === 'm³/s'
          ? ' — the solver receives this series scaled per metre of cell width.'
          : ' — LISFLOOD per-metre-width values (raw discharge ÷ DEM cell size).'}
      </span>
    </div>
  );
}
