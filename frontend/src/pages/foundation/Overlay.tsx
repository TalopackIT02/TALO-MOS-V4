import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import '../../styles/module-scan.css';

// FOUNDATION-REV-01 REV-B — the two overlays of the Foundation screens (04_UI_UX_TWO_SCREENS.md):
//   Drawer       : right-hand panel over the content (max ~680px, full width on mobile) to view / edit ONE entity;
//   ConfirmModal : centred popup for a dangerous / irreversible action (object, current → expected state, impact).
// Both: role=dialog + aria-modal, title, Escape and close button, backdrop click, focus moved in and given back to the
// opener, page scroll locked. No nested overlays: a screen keeps at most one open at a time.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

// UI-01: focus stays inside the dialog (Tab / Shift+Tab cycle), Escape closes, focus returns to the opener.
function useDialog(onClose: () => void, focus: React.RefObject<HTMLElement | null>, box: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focus.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab' || !box.current) return;
      const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const inside = box.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [onClose, focus, box]);
}

export function Drawer({ title, kicker, onClose, children, footer }: { title: string; kicker?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  useDialog(onClose, closeRef, boxRef);
  return (
    <div className="ms-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={boxRef} className="ms-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="ms-drawer-head">
          <div>{kicker && <small className="muted">{kicker}</small>}<h3>{title}</h3></div>
          <button ref={closeRef} type="button" className="ms-close" aria-label="Đóng" onClick={onClose}>×</button>
        </header>
        <div className="ms-drawer-body">{children}</div>
        <footer className="ms-drawer-foot">{footer}<button type="button" className="fx-btn" onClick={onClose}>Đóng</button></footer>
      </section>
    </div>
  );
}

export interface ConfirmSpec {
  readonly title: string;
  readonly object: string;
  readonly transition: string; // current → expected state
  readonly impact: readonly string[];
  readonly irreversible?: string;
  readonly confirmLabel: string;
  readonly danger?: boolean;
}

export function ConfirmModal({ spec, busy, onConfirm, onCancel }: { spec: ConfirmSpec; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  useDialog(onCancel, cancelRef, boxRef);
  return (
    <div className="fx-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <section ref={boxRef} className="fx-modal" role="dialog" aria-modal="true" aria-label={spec.title}>
        <h3>{spec.title}</h3>
        <dl className="ms-dl">
          <dt>Đối tượng</dt><dd>{spec.object}</dd>
          <dt>Trạng thái</dt><dd>{spec.transition}</dd>
        </dl>
        <p><b>Ảnh hưởng</b></p>
        <ul>{spec.impact.map((i) => <li key={i}>{i}</li>)}</ul>
        {spec.irreversible && <p className="fx-msg error">{spec.irreversible}</p>}
        <p className="muted">Máy chủ kiểm tra lại toàn bộ điều kiện; xác nhận ở đây không vượt qua được kiểm tra của hệ thống.</p>
        <div className="fx-toolbar fx-modal-actions">
          <button ref={cancelRef} type="button" className="fx-btn" onClick={onCancel}>Hủy</button>
          <button type="button" className={spec.danger ? 'fx-btn danger' : 'fx-btn primary'} disabled={busy} onClick={onConfirm}>{spec.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
