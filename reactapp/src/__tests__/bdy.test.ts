// reactapp/src/__tests__/bdy.test.ts — parseBdy / parseDischargeCsv contracts.
import { describe, expect, it } from 'vitest';
import { parseBdy, parseDischargeCsv } from '../bdy';

const BDY = [
  '#project made by FIMsim',
  'neuse_us',
  '3\tseconds',
  '10.5\t0',
  '12.0\t3600',
  '13.5\t7200',
].join('\n');

describe('parseBdy', () => {
  it('parses a normal .bdy (comment, name, "<count> <units>", value/time rows)', () => {
    const series = parseBdy(BDY, null);
    expect(series).toHaveLength(1);
    expect(series[0].boundary).toBe('neuse_us');
    // startMs null → epoch 0; time column is seconds → ms; discharge is y.
    expect(series[0].points).toEqual([
      [0, 10.5],
      [3_600_000, 12],
      [7_200_000, 13.5],
    ]);
  });

  it('offsets times by startMs when given', () => {
    const start = Date.UTC(2017, 7, 27); // arbitrary event start
    const series = parseBdy(BDY, start);
    expect(series[0].points[1]).toEqual([start + 3_600_000, 12]);
  });

  it('honours the units word (hours, days; unknown falls back to seconds)', () => {
    const mk = (units: string) => `b\n2 ${units}\n1 0\n2 1`;
    expect(parseBdy(mk('hours'), null)[0].points[1][0]).toBe(3_600_000);
    expect(parseBdy(mk('days'), null)[0].points[1][0]).toBe(86_400_000);
    expect(parseBdy(mk('parsecs'), null)[0].points[1][0]).toBe(1_000);
  });

  it('parses multiple boundaries in one file', () => {
    const text = 'up1\n1 seconds\n5 0\nup2\n2 hours\n6 0\n7 1';
    const series = parseBdy(text, null);
    expect(series.map((s) => s.boundary)).toEqual(['up1', 'up2']);
    expect(series[1].points).toHaveLength(2);
  });

  it('skips malformed rows but keeps the rest of the series', () => {
    const text = 'b\n3 seconds\n1 0\nnot a row\n3 7200';
    const series = parseBdy(text, null);
    expect(series[0].points).toEqual([
      [0, 1],
      [7_200_000, 3],
    ]);
  });

  it('skips stray lines that are not followed by a count/units header', () => {
    const text = 'stray junk line\nb\n1 seconds\n9 0';
    const series = parseBdy(text, null);
    expect(series).toHaveLength(1);
    expect(series[0].boundary).toBe('b');
    expect(series[0].points).toEqual([[0, 9]]);
  });

  it('drops a series with no valid points, and returns [] on empty/comment-only input', () => {
    expect(parseBdy('b\n2 seconds\nx y\nz w', null)).toEqual([]);
    expect(parseBdy('', null)).toEqual([]);
    expect(parseBdy('# only a comment\n\n', null)).toEqual([]);
  });
});

describe('parseDischargeCsv', () => {
  const CSV = [
    'time,discharge_cms',
    '2017-08-27T00:00:00Z,150.5',
    '2017-08-27T01:00:00Z,175.25',
  ].join('\n');

  it('parses datetime,discharge rows into one "discharge" series (header skipped)', () => {
    const series = parseDischargeCsv(CSV);
    expect(series).toHaveLength(1);
    expect(series[0].boundary).toBe('discharge');
    expect(series[0].points).toEqual([
      [Date.parse('2017-08-27T00:00:00Z'), 150.5],
      [Date.parse('2017-08-27T01:00:00Z'), 175.25],
    ]);
  });

  it('tolerates CRLF and blank lines', () => {
    const series = parseDischargeCsv('time,discharge_cms\r\n\r\n2017-08-27T00:00:00Z,1\r\n');
    expect(series[0].points).toEqual([[Date.parse('2017-08-27T00:00:00Z'), 1]]);
  });

  it('skips malformed rows (bad date or non-numeric discharge)', () => {
    const series = parseDischargeCsv(
      'time,discharge_cms\nnot-a-date,5\n2017-08-27T00:00:00Z,n/a\n2017-08-27T02:00:00Z,9');
    expect(series[0].points).toEqual([[Date.parse('2017-08-27T02:00:00Z'), 9]]);
  });

  it('returns [] for empty or header-only input', () => {
    expect(parseDischargeCsv('')).toEqual([]);
    expect(parseDischargeCsv('time,discharge_cms\n')).toEqual([]);
  });
});
