// reactapp/src/bdy.ts
// LISFLOOD-FP .bdy parsing — dependency-free so it tests standalone.
export interface Series {
  boundary: string;
  /** [epoch-ms, discharge m³/s] */
  points: [number, number][];
}

const UNIT_SECONDS: Record<string, number> = {
  seconds: 1, hours: 3600, days: 86400,
};

/** Parse a LISFLOOD-FP .bdy: comment lines, then per boundary:
 *  name / "<count> <units>" / count rows of "<value> <time>". */
export function parseBdy(text: string, startMs: number | null): Series[] {
  const lines = text.split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const series: Series[] = [];
  let i = 0;
  while (i < lines.length - 1) {
    const name = lines[i];
    const m = lines[i + 1].match(/^(\d+)\s+(\w+)$/);
    if (!m) { i += 1; continue; }
    const count = Number(m[1]);
    const mult = (UNIT_SECONDS[m[2].toLowerCase()] ?? 1) * 1000;
    const points: [number, number][] = [];
    for (let j = 0; j < count && i + 2 + j < lines.length; j++) {
      const [q, t] = lines[i + 2 + j].split(/\s+/).map(Number);
      if (Number.isFinite(q) && Number.isFinite(t)) {
        points.push([(startMs ?? 0) + t * mult, q]);
      }
    }
    if (points.length) series.push({ boundary: name, points });
    i += 2 + count;
  }
  return series;
}


/** Parse a TRITON .hyg: "%"-comment lines, then rows of
 *  "<time_hr>,<discharge_cms>[,<discharge_cms_2>…]". Unlike the LISFLOOD .bdy
 *  the values are true discharge (m³/s) and the time column is in HOURS. Only
 *  the first source column is charted. */
export function parseHyg(text: string, startMs: number | null): Series[] {
  const points: [number, number][] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%') || line.startsWith('#')) continue;
    const cols = line.split(',');
    const t = Number(cols[0]);
    const q = Number(cols[1]);
    if (Number.isFinite(t) && Number.isFinite(q)) {
      points.push([(startMs ?? 0) + t * 3_600_000, q]); // hours → ms
    }
  }
  return points.length ? [{ boundary: 'inflow discharge', points }] : [];
}


export interface ParsedSeries {
  series: Series[];
  /** true discharge (m³/s) vs LISFLOOD's per-metre-width inflow (m²/s) */
  unit: 'm³/s' | 'm²/s';
  note?: string;
}

/** "time_hours,discharge_cms" CSV → true discharge series. */
export function parseDischargeCsv(text: string): Series[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const points: [number, number][] = [];
  for (const line of lines.slice(1)) {
    const [ts, q] = line.split(',');
    const t = Date.parse(ts);
    const v = Number(q);
    if (Number.isFinite(t) && Number.isFinite(v)) points.push([t, v]);
  }
  return points.length ? [{ boundary: 'discharge', points }] : [];
}
