// reactapp/src/HydrographChart.tsx
// FE5's centerpiece: the event hydrograph, read from the ACTUAL .bdy file a
// run produced (what you see is literally what LISFLOOD-FP consumes). The
// echarts bundle is heavy, so the chart lazy-loads; parsing happens here.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type EChartsReact from 'echarts-for-react';
import { getStepRunOutputs, type ServerStepRun } from './api';
import { parseBdy, parseDischargeCsv, parseHyg, type Series } from './bdy';
import { dischargeOutputs } from './flowTool';
import { fileProxyUrl, pngFilename, saveBlob } from './outputsMeta';
import { dateAxisMinInterval, formatDateTick, formatDateTime } from './hydrographAxis';

const ReactECharts = lazy(() => import('echarts-for-react'));

export default function HydrographChart({ run, aoiName = 'area' }: {
  run: ServerStepRun;
  /** names the PNG download (FE69): `<area>_<step>_hydrograph.png` */
  aoiName?: string;
}) {
  // echarts-for-react's instance, for the PNG export
  const chartRef = useRef<EChartsReact | null>(null);
  const [saving, setSaving] = useState(false);
  const [series, setSeries] = useState<Series[] | null>(null);
  const [unit, setUnit] = useState<'m³/s' | 'm²/s'>('m³/s');
  const [error, setError] = useState<string | null>(null);
  const [absolute, setAbsolute] = useState(false);
  const [sourceNote, setSourceNote] = useState<string>('');

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
        // FE64: the Streamflow tool writes one CSV per ID — every one is a series
        const toolCsvs = dischargeOutputs(outputs);
        if (toolCsvs.length) {
          const src = String((run.config ?? {}).source ?? '');
          if (alive) setSourceNote(
            src === 'usgs' ? 'USGS gages' : src === 'nwm_forecast' ? 'NWM Forecast' : 'NWM Retrospective');
          const all = await Promise.all(toolCsvs.map(async (c) => parseDischargeCsv(
            await (await fetch(fileProxyUrl(run.id, c.name))).text(),
          ).map((s) => ({ ...s, boundary: c.label }))));
          const flat = all.flat();
          if (!flat.length) throw new Error('no readable series in the discharge CSVs');
          if (alive) { setSeries(flat); setUnit('m³/s'); setAbsolute(true); }
          return;
        }
        // Prefer the raw NWM/gage CSV: true discharge in m³/s. The .bdy holds
        // LISFLOOD's per-metre-width inflow (Q ÷ cell width) — correct for
        // the solver, misleading as "discharge".
        // same-origin proxy: presigned MinIO URLs are CORS-hostile to fetch()
        const csv = outputs.find((o) => /discharge.*\.csv$/i.test(o.name));
        {
          // Phase 3: the desktop's per-AOI caption — data source + reach/gage id
          const cfg = (run.config ?? {}) as Record<string, unknown>;
          const src = String(cfg.bdy_source ?? 'nwm_retro');
          const reach = csv && /NWM_(\d+)_/.exec(csv.name)?.[1];
          if (alive) setSourceNote(
            src === 'usgs' ? `USGS gage ${cfg.gage_id ?? '?'}`
              : src === 'nwm_forecast' ? `NWM Forecast${reach ? ` · reach ${reach}` : ''}`
              : `NWM Retrospective${reach ? ` · reach ${reach}` : ''}`);
        }
        if (csv) {
          const parsed = parseDischargeCsv(
            await (await fetch(fileProxyUrl(run.id, csv.name))).text());
          if (parsed.length) {
            if (alive) { setSeries(parsed); setUnit('m³/s'); setAbsolute(true); }
            return;
          }
        }
        // TRITON has no .bdy — its flow step ships a .hyg (true discharge, cms)
        const hyg = outputs.find((o) => o.name.toLowerCase().endsWith('.hyg'));
        if (hyg) {
          const parsed = parseHyg(
            await (await fetch(fileProxyUrl(run.id, hyg.name))).text(), startMs);
          if (!parsed.length) throw new Error('no readable series in the .hyg');
          if (alive) { setSeries(parsed); setUnit('m³/s'); setAbsolute(false); }
          return;
        }
        const bdy = outputs.find((o) => o.name.toLowerCase().endsWith('.bdy'));
        if (!bdy) throw new Error('no .bdy in outputs');
        const text = await (await fetch(fileProxyUrl(run.id, bdy.name))).text();
        const parsed = parseBdy(text, startMs);
        if (!parsed.length) throw new Error('no readable series in the .bdy');
        if (alive) { setSeries(parsed); setUnit('m²/s'); setAbsolute(false); }
      } catch (e) {
        if (alive) setError(String((e as Error).message ?? e));
      }
    })();
    return () => { alive = false; };
  }, [run.id, run.config, startMs]);

  if (error) return <span className="sp-muted">hydrograph unavailable ({error})</span>;
  if (!series) return <span className="sp-muted">loading hydrograph…</span>;

  const s0 = series[0];
  const peakOf = (s: Series) => s.points.reduce((a, b) => (b[1] > a[1] ? b : a));
  // the caption's peak is the highest point across ALL series (several IDs on a tool run)
  const peak = series.map(peakOf).reduce((a, b) => (b[1] > a[1] ? b : a));
  const toolRun = run.step_key === 'flow_tool';
  const spanMs = s0.points[s0.points.length - 1][0] - s0.points[0][0];
  const durationH = spanMs / 3.6e6;

  const option = {
    animation: false,
    grid: { left: 60, right: 24, top: 30, bottom: 64 },
    legend: { bottom: 0, left: 'center', textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: number) => `${Number(v).toFixed(2)} ${unit}`,
    },
    xAxis: (!absolute && startMs === null) ? {
      type: 'value',
      name: 'hours',
      nameLocation: 'middle',
      nameGap: 30,
      axisLabel: { formatter: (v: number) => `${(v / 3.6e6).toFixed(0)} h` },
    } : {
      // FE53: calendar dates on the ticks ("Oct 05"), thinned by echarts on
      // long windows (hideOverlap) but the first/last always labelled; the
      // tooltip header keeps the full date-time.
      type: 'time',
      name: 'Date (UTC)',
      nameLocation: 'middle',
      nameGap: 30,
      minInterval: dateAxisMinInterval(spanMs),
      axisLabel: {
        formatter: (v: number) => formatDateTick(v, spanMs),
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
      },
      axisPointer: {
        label: { formatter: (p: { value: number }) => formatDateTime(Number(p.value)) },
      },
    },
    yAxis: {
      type: 'value',
      name: unit === 'm³/s' ? 'discharge (m³/s)'
        : 'inflow per metre width (m²/s)',
      nameTextStyle: { color: '#28899D' },
    },
    series: series.map((s) => {
      const pk = peakOf(s);
      return {
      name: s.boundary,
      type: 'line',
      data: s.points,
      showSymbol: false,
      lineStyle: series.length > 1 ? { width: 2 } : { color: '#123458', width: 2 },
      areaStyle: series.length > 1 ? undefined : { color: 'rgba(37, 194, 223, 0.25)' },
      markPoint: {
        data: [{ coord: pk, name: 'peak' }],
        symbolSize: 44,
        // one series: the brand cyan; several: each marker takes its line's colour
        ...(series.length > 1 ? {} : { itemStyle: { color: '#25C2DF' } }),
        label: {
          formatter: () => `${pk[1].toFixed(1)}`,
          color: '#152428', fontSize: 10,
        },
      },
      };
    }),
  };

  const caption = (sourceNote ? `${sourceNote} · ` : '')
    + (series.length > 1 ? `${series.length} series · ` : `${s0.boundary} · `)
    + `peak ${peak[1].toFixed(1)} ${unit} · ${durationH.toFixed(0)} h event`
    + (startMs !== null ? ` from ${formatDateTime(s0.points[0][0])}` : '');

  // FE69: the chart as a PNG (2× for slides), with the caption drawn in as a
  // title for the export only — the on-screen caption stays below the chart.
  const downloadPng = async () => {
    const inst = chartRef.current?.getEchartsInstance();
    if (!inst) return;
    setSaving(true);
    try {
      inst.setOption({ title: { show: true, text: caption, left: 'center', top: 4,
        textStyle: { fontSize: 11, fontWeight: 'normal', color: '#152428' } } });
      const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
      inst.setOption({ title: { show: false } });
      saveBlob(await (await fetch(url)).blob(), pngFilename(aoiName, run.step_key));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hg-wrap">
      <Suspense fallback={<span className="sp-muted">loading chart…</span>}>
        <ReactECharts ref={chartRef} option={option} style={{ height: 230 }} notMerge />
      </Suspense>
      <div className="hg-caption">
        <span className="sp-muted">
          {caption}
          {unit === 'm³/s'
            ? (toolRun ? ' — one series per ID, as downloaded.'
              : ' — the solver receives this series scaled per metre of cell width.')
            : ' — LISFLOOD per-metre-width values (raw discharge ÷ DEM cell size).'}
        </span>
        <button type="button" className="button-secondary hg-png" disabled={saving}
                onClick={() => void downloadPng()}>
          {saving ? 'Saving…' : '⬇ PNG'}
        </button>
      </div>
    </div>
  );
}
