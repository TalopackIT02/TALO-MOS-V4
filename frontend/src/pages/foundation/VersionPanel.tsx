import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { foundationApi, isJsonObject } from '../../services/foundation/foundationApi';
import type { ModuleRecord, VersionRecord } from '../../services/foundation/foundationApi';
import { FeedbackLine, StatusTag, formatTime, settle } from './common';
import type { Feedback } from './common';
import { DataTable } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';

// FE-04 / FE-05 — versions of one module: create a DRAFT, edit the MIC JSON (DRAFT only), SUBMIT, then the lifecycle
// actions that match the known status. ACTIVATE / RETIRE / REJECT ask for confirmation. The backend validates everything
// (MIC codes, gates, state machine); its answer is shown as is.

type Action = 'submit' | 'approve' | 'reject' | 'activate' | 'retire';

const ACTIONS: Record<string, { action: Action; label: string; confirm?: string; primary?: boolean }[]> = {
  DRAFT: [{ action: 'submit', label: 'Nộp xét duyệt', primary: true }],
  IN_REVIEW: [
    { action: 'approve', label: 'Duyệt', primary: true },
    { action: 'reject', label: 'Từ chối', confirm: 'Từ chối phiên bản này? Phiên bản bị từ chối không thể chuyển sang trạng thái khác.' },
  ],
  APPROVED: [{
    action: 'activate', label: 'Kích hoạt', primary: true,
    confirm: 'Kích hoạt phiên bản này? Nếu module đang có phiên bản ACTIVE, phiên bản đó sẽ chuyển sang RETIRED trong cùng thao tác.',
  }],
  ACTIVE: [{ action: 'retire', label: 'Ngừng sử dụng', confirm: 'Ngừng sử dụng phiên bản đang hoạt động? Hệ thống không tự kích hoạt phiên bản khác.' }],
};

// A starting MIC-1.0 for a new DRAFT (edited by the user; validated by the backend at SUBMIT).
function micTemplate(moduleKey: string, moduleVersion: string, moduleName: string) {
  return {
    mic01Identity: { moduleKey, moduleName, moduleVersion, micStandard: 'MIC-1.0' },
    mic02Functions: [{ functionKey: 'MAIN', name: 'Chức năng chính' }],
    mic03Actions: [{ functionKey: 'MAIN', actionKey: 'READ', name: 'Xem', nature: 'READ' }],
    mic04Navigation: [{ menuLabel: moduleName }, { menuLabel: 'Chức năng chính', routePath: `/${moduleKey.toLowerCase()}`, screenKey: `${moduleKey.toLowerCase()}.main`, functionKey: 'MAIN' }],
    mic05Api: [],
    mic06DataResources: [],
    mic07IamMapping: [{ functionKey: 'MAIN', actionKey: 'READ', moduleCode: moduleKey, resourceCode: 'MAIN', operation: 'READ', minimumAssuranceLevel: 1 }],
    mic08EventsAudit: { eventCodes: [], auditActionCodes: [] },
    mic09Compatibility: { kind: 'INITIAL_REGISTRATION', changes: [] },
    mic10Manifest: { manifestVersion: 'MIC-1.0', hashAlgorithm: 'SHA-256', testEvidence: [{ name: 'Kiểm thử', result: 'NOT_TESTED', reference: '—' }] },
  };
}

// FIX-FE-MIC-SAVE-01: text shown for a version. The template is ONLY for a DRAFT that has no stored manifest yet; a
// stored manifest is always shown as stored; a locked version without manifest shows nothing.
function micText(version: VersionRecord, moduleKey: string, moduleName: string): string {
  if (version.manifestJson !== null) return JSON.stringify(version.manifestJson, null, 2);
  return version.status === 'DRAFT' ? JSON.stringify(micTemplate(moduleKey, version.moduleVersion, moduleName), null, 2) : '';
}

// Key-order independent JSON equality (PostgreSQL jsonb does not keep the key order of the request).
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (isJsonObject(a) && isJsonObject(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameJson(a[k], b[k]));
  }
  return a === b;
}

// WS03: version list (client mode — a module has few versions). Sort values are ISO timestamps / SemVer text.
const VERSION_COLUMNS: Column<VersionRecord>[] = [
  { key: 'moduleVersion', label: 'Phiên bản', value: (x) => x.moduleVersion, render: (x) => <b>{x.moduleVersion}</b> },
  { key: 'status', label: 'Trạng thái', value: (x) => x.status, render: (x) => <StatusTag status={x.status} /> },
  { key: 'createdAt', label: 'Tạo lúc', value: (x) => x.createdAt, render: (x) => formatTime(x.createdAt), searchable: false },
  { key: 'reviewedAt', label: 'Duyệt lúc', value: (x) => x.reviewedAt ?? '', render: (x) => formatTime(x.reviewedAt), searchable: false },
  { key: 'activatedAt', label: 'Kích hoạt', value: (x) => x.activatedAt ?? '', render: (x) => formatTime(x.activatedAt), searchable: false },
];

export interface VersionPanelProps {
  readonly module: ModuleRecord;
  readonly onSessionLost: () => void;
  readonly onChanged: () => void;
}

export function VersionPanel({ module, onSessionLost, onChanged }: VersionPanelProps) {
  const [versions, setVersions] = useState<VersionRecord[] | null>(null);
  const [selected, setSelected] = useState<VersionRecord | null>(null);
  const [newVersion, setNewVersion] = useState('1.0.0');
  const [mic, setMic] = useState('');
  // True while the textarea holds edits that are not confirmed as stored: no reload may overwrite them.
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  // `keepEdits`: a reload after another action keeps unsaved edits of the textarea (never replaced by stored / template).
  const load = useCallback(async (keepId?: string, keepEdits = false) => {
    const data = settle(await foundationApi.listVersions(module.moduleId), onSessionLost, setFeedback);
    setVersions(data ?? []);
    if (keepId && data) {
      const found = data.find((x) => x.versionId === keepId) ?? null;
      setSelected(found);
      if (found && !keepEdits) {
        setMic(micText(found, module.moduleKey, module.moduleName));
        setDirty(false);
      }
    }
  }, [module, onSessionLost]);

  useEffect(() => {
    void load();
  }, [load]);

  function discardOk(): boolean {
    return !dirty || window.confirm('Hồ sơ MIC đang sửa chưa được lưu. Bỏ các thay đổi này?');
  }

  function choose(version: VersionRecord) {
    if (!discardOk()) return;
    setFeedback(null);
    setSelected(version);
    setMic(micText(version, module.moduleKey, module.moduleName));
    setDirty(false);
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const data = settle(await foundationApi.createVersion(module.moduleId, newVersion.trim(), 'MIC-1.0'), onSessionLost, setFeedback);
      if (data) {
        setFeedback({ tone: 'success', text: `Đã tạo phiên bản nháp ${data.moduleVersion}.` });
        await load(data.versionId);
      }
    });
  }

  function parsedMic(): Record<string, unknown> | null {
    try {
      const value: unknown = JSON.parse(mic);
      if (isJsonObject(value)) return value;
      setFeedback({ tone: 'error', text: 'Hồ sơ MIC phải là một đối tượng JSON.' });
    } catch (error) {
      setFeedback({ tone: 'error', text: `JSON không hợp lệ: ${error instanceof Error ? error.message : 'lỗi cú pháp'}.` });
    }
    return null;
  }

  async function save() {
    if (!selected) return;
    const manifest = parsedMic();
    if (!manifest) return;
    await run(async () => {
      // "Đã lưu" only when the PUT answer AND a fresh GET of the version both hold exactly the manifest sent; otherwise
      // the textarea keeps the user's text and an error is shown (no template, no stale content).
      const put = settle(await foundationApi.putManifest(module.moduleId, selected.versionId, manifest), onSessionLost, setFeedback);
      if (!put) return;
      if (!sameJson(put.manifestJson, manifest)) {
        setFeedback({ tone: 'error', text: 'Máy chủ trả về hồ sơ MIC khác với nội dung đã gửi; chưa xác nhận đã lưu. Nội dung đang sửa được giữ nguyên.' });
        return;
      }
      const stored = settle(await foundationApi.getVersion(module.moduleId, selected.versionId), onSessionLost, setFeedback);
      if (!stored) return;
      if (!sameJson(stored.manifestJson, manifest)) {
        setFeedback({ tone: 'error', text: 'Đọc lại phiên bản không thấy hồ sơ MIC vừa lưu; chưa xác nhận đã lưu. Nội dung đang sửa được giữ nguyên.' });
        return;
      }
      setSelected(stored);
      setMic(micText(stored, module.moduleKey, module.moduleName));
      setDirty(false);
      setFeedback({ tone: 'success', text: 'Đã lưu hồ sơ MIC (bản nháp) và đọc lại xác nhận khớp. Nộp xét duyệt để hệ thống kiểm tra đầy đủ.' });
      await load(stored.versionId, true);
    });
  }

  async function act(action: Action, confirmText?: string) {
    if (!selected) return;
    // SUBMIT uses the STORED manifest: unsaved edits must be saved first (they are never discarded silently).
    if (dirty) return setFeedback({ tone: 'error', text: 'Hồ sơ MIC có thay đổi chưa lưu. Nhấn “Lưu MIC” trước khi nộp xét duyệt.' });
    if (confirmText && !window.confirm(confirmText)) return;
    await run(async () => {
      const data = settle(await foundationApi.lifecycle(module.moduleId, selected.versionId, action), onSessionLost, setFeedback);
      if (data) {
        setFeedback({ tone: 'success', text: `Phiên bản ${data.moduleVersion}: ${data.status}.` });
        onChanged();
      }
      await load(selected.versionId);
    });
  }

  const isDraft = selected?.status === 'DRAFT';
  return (
    <div className="fx-section">
      <h3>Phiên bản của {module.moduleKey}</h3>
      <FeedbackLine feedback={feedback} />
      <form className="fx-toolbar" onSubmit={(e) => void create(e)}>
        <label className="muted" htmlFor="fx-new-version">Phiên bản mới (SemVer)</label>
        <input id="fx-new-version" className="search" style={{ width: 140 }} value={newVersion} onChange={(e) => setNewVersion(e.target.value)} />
        <button type="submit" className="fx-btn primary" disabled={busy}>Tạo phiên bản nháp</button>
        <button type="button" className="fx-btn" onClick={() => { if (discardOk()) void load(selected?.versionId); }}>Tải lại</button>
      </form>
      <DataTable
        label="phiên bản"
        compact
        columns={VERSION_COLUMNS}
        rows={versions}
        rowKey={(x) => x.versionId}
        selectedKey={selected?.versionId ?? null}
        emptyText="Module chưa có phiên bản nào."
        pageSizes={[5, 10, 25]}
        initial={{ pageSize: 10, sort: 'createdAt', dir: 'desc' }}
        actions={(x) => <button type="button" className="fx-btn" onClick={() => choose(x)}>Chi tiết</button>}
      />
      {selected && (
        <div className="fx-section">
          <h3>Phiên bản {selected.moduleVersion} · <StatusTag status={selected.status} /></h3>
          <div className="fx-meta">
            <span><b>Chuẩn hợp đồng:</b> {selected.contractVersion}</span>
            <span><b>Mã băm MIC:</b> {selected.manifestHash ?? '—'}</span>
            <span><b>Nộp bởi:</b> {selected.submittedByAccountId ?? '—'}</span>
            <span><b>Duyệt bởi:</b> {selected.reviewedByAccountId ?? '—'} · {formatTime(selected.reviewedAt)}</span>
          </div>
          <div className="fx-toolbar">
            {isDraft && <button type="button" className="fx-btn" disabled={busy} onClick={() => void save()}>Lưu MIC</button>}
            {(ACTIONS[selected.status] ?? []).map((a) => (
              <button key={a.action} type="button" className={a.primary ? 'fx-btn primary' : 'fx-btn danger'} disabled={busy} onClick={() => void act(a.action, a.confirm)}>
                {a.label}
              </button>
            ))}
          </div>
          <label className="muted" htmlFor="fx-mic">{isDraft ? 'Hồ sơ MIC (JSON) — chỉ sửa được khi phiên bản là bản nháp' : 'Hồ sơ MIC đã khóa (chỉ xem)'}</label>
          <textarea id="fx-mic" className="fx-mic" spellCheck={false} readOnly={!isDraft} value={mic} onChange={(e) => { setMic(e.target.value); setDirty(true); }} />
          {isDraft && dirty && <p className="muted">Có thay đổi chưa lưu.</p>}
        </div>
      )}
    </div>
  );
}
