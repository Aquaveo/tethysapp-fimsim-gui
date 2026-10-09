// reactapp/src/ConfirmDialog.tsx
// A small modal "are you sure?" (FIMSIM-FE56). Focus lands on the SAFE
// action (cancel); Escape and a backdrop click also cancel.
import { useEffect, useRef, type ReactNode } from 'react';
import './ConfirmDialog.css';

export default function ConfirmDialog({
  title, children, confirmLabel, cancelLabel, onConfirm, onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="cd-backdrop" onClick={onCancel}>
      <div className="cd-card" role="alertdialog" aria-modal="true"
           aria-labelledby="cd-title" aria-describedby="cd-body"
           onClick={(e) => e.stopPropagation()}>
        <h2 id="cd-title" className="cd-title">{title}</h2>
        <div id="cd-body" className="cd-body">{children}</div>
        <div className="cd-actions">
          <button type="button" className="button-secondary" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="button-primary" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
