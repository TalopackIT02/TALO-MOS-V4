import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { foundationApi, isJsonObject } from '../../services/foundation/foundationApi';
import type { ModuleRecord, VersionRecord } from '../../services/foundation/foundationApi';
import { FeedbackLine, StatusTag, formatTime, settle } from './common';
import type { Feedback } from './common';

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
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (keepId?: string) => {
    const data = settle(await foundationApi.listVersions(module.moduleId), onSessionLost, setFeedback);
    setVersions(data ?? []);
    if (keepId && data) {
      const found = data.find((x) => x.versionId === keepId) ?? null;
      setSelected(found);
      if (found) setMic(found.manifestJson === null ? JSON.stringify(micTemplate(module.moduleKey, found.moduleVersion, module.moduleName), null, 2) : JSON.stringify(found.manifestJson, null, 2));
    }
  }, [module, onSessionLost]);

  useEffect(() => {
    void load();
  }, [load]);

  function choose(version: VersionRecord) {
    setFeedback(null);
    setSelected(version);
    setMic(version.manifestJson === null ? JSON.stringify(micTemplate(module.moduleKey, version.moduleVersion, module.moduleName), null, 2) : JSON.stringify(version.manifestJson, null, 2));
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
      const data = settle(await foundationApi.putManifest(module.moduleId, selected.versionId, manifest), onSessionLost, setFeedback);
      if (data) {
        setFeedback({ tone: 'success', text: 'Đã lưu hồ sơ MIC (bản nháp). Nộp xét duyệt để hệ thống kiểm tra đầy đủ.' });
        await load(data.versionId);
      }
    });
  }

  async function act(action: Action, confirmText?: string) {
    if (!selected) return;
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
        <button type="button" className="fx-btn" onClick={() => void load(selected?.versionId)}>Tải lại</button>
      </form>
      {versions === null ? <p className="info">Đang tải…</p> : versions.length === 0 ? <p className="info">Module chưa có phiên bản nào.</p> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Tạo lúc</th><th>Duyệt lúc</th><th>Kích hoạt</th><th /></tr></thead>
            <tbody>
              {versions.map((x) => (
                <tr key={x.versionId} className={x.versionId === selected?.versionId ? 'fx-selected' : undefined}>
                  <td><b>{x.moduleVersion}</b></td>
                  <td><StatusTag status={x.status} /></td>
                  <td>{formatTime(x.createdAt)}</td>
                  <td>{formatTime(x.reviewedAt)}</td>
                  <td>{formatTime(x.activatedAt)}</td>
                  <td><button type="button" className="fx-btn" onClick={() => choose(x)}>Chi tiết</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
          <textarea id="fx-mic" className="fx-mic" spellCheck={false} readOnly={!isDraft} value={mic} onChange={(e) => setMic(e.target.value)} />
        </div>
      )}
    </div>
  );
}
