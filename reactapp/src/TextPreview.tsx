// reactapp/src/TextPreview.tsx
// Visuals plan Phase 3 — the desktop's monospace file previews: the generated
// .par/.cfg/.bci/.src/.extbc shown right on the step that produced them, plus
// the LISFLOOD run-command chip (desktop's persistent banner). Files are tiny
// (bytes–KBs) and fetched through the same-origin proxy on first open.
import { useEffect, useState } from 'react';
import type { ServerStepRun } from './api';
import { fileProxyUrl } from './outputsMeta';
import './TextPreview.css';

/** which manifest files each step previews, in display order */
const STEP_TEXT_FILES: Record<string, RegExp[]> = {
  par: [/\.par$/i],
  tcfg: [/\.cfg$/i],
  bci: [/\.bci$/i],
  tbc: [/\.src$/i, /\.extbc$/i],
};

/**
 * Whether a step's text preview starts expanded. The Boundaries files
 * (.bci / .src + .extbc) are the step's whole point, so they're open by
 * default and shown right below the map (bug-round #ix); the Settings
 * files stay open only when there's a single AOI to avoid a wall of text.
 */
export function textPreviewDefaultOpen(stepKey: string, aoiCount: number): boolean {
  if (stepKey === 'bci' || stepKey === 'tbc') return true;
  if (stepKey === 'par' || stepKey === 'tcfg') return aoiCount === 1;
  return false;
}

function FileText({ runId, name }: { runId: number; name: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    fetch(fileProxyUrl(runId, name))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setText)
      .catch(() => setText('(could not load the file)'));
  }, [runId, name]);
  return (
    <div className="tp-file">
      <span className="tp-name">{name}</span>
      <pre className="tp-pre">{text ?? 'loading…'}</pre>
    </div>
  );
}

export default function TextPreview({ run, stepKey, defaultOpen }: {
  run: ServerStepRun;
  stepKey: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const patterns = STEP_TEXT_FILES[stepKey] ?? [];
  const files = patterns.flatMap((re) =>
    (Array.isArray(run.manifest) ? run.manifest : [])
      .filter((m) => re.test(m.name)).map((m) => m.name));
  if (!files.length) return null;

  return (
    <details className="tp" open={open}
             onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        {stepKey === 'par' ? 'Generated .par file'
          : stepKey === 'tcfg' ? 'Generated .cfg file'
          : stepKey === 'bci' ? 'Generated .bci file'
          : 'Generated .src / .extbc files'}
      </summary>
      {open && (
        <div className="tp-body">
          {files.map((name) => <FileText key={name} runId={run.id} name={name} />)}
          {stepKey === 'par' && (
            <p className="tp-cmd">
              Run it anywhere LISFLOOD-FP is installed:{' '}
              <code>lisflood -v {files[0]}</code>
            </p>
          )}
        </div>
      )}
    </details>
  );
}
