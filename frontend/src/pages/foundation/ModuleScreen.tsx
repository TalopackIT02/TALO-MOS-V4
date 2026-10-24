import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { foundationApi } from '../../services/foundation/foundationApi';
import type { ModuleRecord } from '../../services/foundation/foundationApi';
import { installerApi } from '../../services/foundation/moduleScanApi';
import type { Candidate } from '../../services/foundation/moduleScanApi';
import { FeedbackLine, formatTime, settle } from './common';
import type { Feedback } from './common';
import { VersionPanel } from './VersionPanel';
import { DataTable, NameCode } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import { useShellData } from '../../contexts/ShellData';
import { candidateIdOfPath, candidateWorkspacePath } from '../../routes/shellScreens';
import type { ShellPath } from '../../routes/shellScreens';
import type { OpenPath } from '../../routes/navigation';
import { ModuleScanButton, ModuleScanResults, SCAN_PERMISSIONS, useModuleScan } from './ModuleScan';
import { CandidateWorkspace } from './CandidateWorkspace';
import { ConfirmModal, Drawer } from './Overlay';

// FE-03 + FOUNDATION-REV-01 REV-B — Quản lý Module (/foundation/modules): the module table, the manual scan with its
// compact result, the recent candidates; one module's detail and versions open in the right drawer; ENABLE / DISABLE is
// confirmed in a popup. "Kiểm tra & Chạy thử" opens the Candidate Workspace page (/foundation/modules/candidates/:id).
// Tab 1 (advanced) keeps the manual registration form; installing from a package never needs it.

const isTestModule = (m: ModuleRecord) => m.moduleKey.startsWith('FBET_');

const MODULE_COLUMNS: Column<ModuleRecord>[] = [
  { key: 'moduleName', label: 'Module', value: (m) => `${m.moduleName} ${m.moduleKey}`, render: (m) => <NameCode name={m.moduleName} code={m.moduleKey} /> },
  { key: 'description', label: 'Mô tả', value: (m) => m.description ?? '', render: (m) => m.description ?? <span className="muted">—</span> },
  { key: 'moduleType', label: 'Loại', value: (m) => m.moduleType },
  { key: 'isEnabled', label: 'Trạng thái', value: (m) => (m.isEnabled ? 'Đang bật' : 'Đang tắt'), render: (m) => <span className={m.isEnabled ? 'tag fx-status-active' : 'tag'}>{m.isEnabled ? 'Đang bật' : 'Đang tắt'}</span> },
  { key: 'updatedAt', label: 'Cập nhật', value: (m) => m.updatedAt, render: (m) => formatTime(m.updatedAt), searchable: false },
];
const CANDIDATE_TEXT: Record<string, string> = {
  SCANNED: 'Đã quét', VALIDATING: 'Đang kiểm tra', NEEDS_FIX: 'Cần sửa', READY: 'READY', INVALIDATED: 'Mất hiệu lực', CANCELLED: 'Đã hủy', ERROR: 'Lỗi engine',
};

export interface ModuleScreenProps {
  readonly tab: number;
  readonly path: ShellPath;
  readonly onSessionLost: () => void;
  readonly onOpenPath: OpenPath;
}

export function ModuleScreen({ tab, path, onSessionLost, onOpenPath }: ModuleScreenProps) {
  const { can } = useShellData();
  const candidateId = candidateIdOfPath(path);
  if (candidateId !== null) {
    return <CandidateWorkspace key={candidateId} candidateId={candidateId} canInstall={can('foundation.module_version.activate')} onSessionLost={onSessionLost} onOpenPath={onOpenPath} />;
  }
  if (tab === 1) return <RegisterForm onSessionLost={onSessionLost} />;
  return <ModuleList onSessionLost={onSessionLost} onOpenPath={onOpenPath} />;
}

function ModuleList({ onSessionLost, onOpenPath }: { onSessionLost: () => void; onOpenPath: OpenPath }) {
  const [modules, setModules] = useState<ModuleRecord[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [detail, setDetail] = useState<ModuleRecord | null>(null);
  const [toggling, setToggling] = useState<ModuleRecord | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTestModules, setShowTestModules] = useState(false);
  const { can } = useShellData();
  // FMI-01: manual module scan — shown only with BOTH registry permissions (the server checks them again).
  const canScan = SCAN_PERMISSIONS.every((p) => can(p));
  const scanner = useModuleScan(onSessionLost);

  const load = useCallback(async () => {
    const data = settle(await foundationApi.listModules(), onSessionLost, setFeedback);
    setModules(data ?? []);
    if (data && detail) setDetail(data.find((m) => m.moduleId === detail.moduleId) ?? null);
  }, [onSessionLost, detail]);

  useEffect(() => {
    void (async () => {
      setModules(settle(await foundationApi.listModules(), onSessionLost, setFeedback) ?? []);
      // Recent candidates: a passive read (a failure is not an alert of the user's action).
      const r = await installerApi.listCandidates();
      if (r.ok) setCandidates(r.data);
      else if (r.status === 401) onSessionLost();
    })();
  }, [onSessionLost]);

  async function openCandidate(scanId: string, moduleKey: string) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const r = await installerApi.createCandidate(scanId, moduleKey);
    setBusy(false);
    if (r.ok) onOpenPath(candidateWorkspacePath(r.data.candidateId));
    else if (r.status === 401) onSessionLost();
    else setFeedback({ tone: 'error', text: r.code === 'SCAN_NOT_FOUND' ? 'Kết quả quét đã hết hạn: bấm Quét Module lại.' : r.code === 'CANDIDATE_NOT_ELIGIBLE' ? 'Package chưa đủ điều kiện kiểm tra (còn lỗi quét tĩnh).' : `Không tạo được candidate (${r.code}).` });
  }

  async function toggle(module: ModuleRecord) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const result = module.isEnabled ? await foundationApi.disableModule(module.moduleId) : await foundationApi.enableModule(module.moduleId);
    const data = settle(result, onSessionLost, setFeedback);
    if (data) setFeedback({ tone: 'success', text: `Module ${data.moduleKey} đã ${data.isEnabled ? 'bật' : 'tắt'}.` });
    setToggling(null);
    setBusy(false);
    await load();
  }

  // Display filter only (the API data is unchanged): integration-test fixtures (FBET_*) are hidden unless asked for.
  const hiddenCount = showTestModules ? 0 : (modules ?? []).filter(isTestModule).length;
  const visible = modules === null ? null : showTestModules ? modules : modules.filter((m) => !isTestModule(m));
  const recent = candidates.filter((c) => showTestModules || !c.moduleKey.startsWith('FBET_')).slice(0, 6);
  return (
    <>
      <div className="fx-toolbar">
        {canScan && <ModuleScanButton loading={scanner.state.kind === 'LOADING'} onScan={() => void scanner.scan()} />}
        <button type="button" className="fx-btn" onClick={() => void load()}>Tải lại</button>
        <label className="muted"><input type="checkbox" checked={showTestModules} onChange={(e) => setShowTestModules(e.target.checked)} /> Hiện module kiểm thử</label>
        {hiddenCount > 0 && <span className="muted">Đang ẩn {hiddenCount} module kiểm thử (FBET_).</span>}
      </div>
      <FeedbackLine feedback={feedback} />
      {canScan && <ModuleScanResults state={scanner.state} lastScanId={scanner.lastScanId} onReopen={() => void scanner.reopen()} onPreflight={(scanId, moduleKey) => void openCandidate(scanId, moduleKey)} />}
      {recent.length > 0 && (
        <div className="ms-candidates" aria-label="Ứng viên gần đây">
          <b>Ứng viên gần đây:</b>
          {recent.map((c) => (
            <button key={c.candidateId} type="button" className="fx-btn" onClick={() => onOpenPath(candidateWorkspacePath(c.candidateId))}>
              {c.moduleKey} {c.packageVersion} · {CANDIDATE_TEXT[c.status] ?? c.status}
            </button>
          ))}
        </div>
      )}
      <DataTable
        label="module"
        columns={MODULE_COLUMNS}
        rows={visible}
        rowKey={(m) => m.moduleId}
        selectedKey={detail?.moduleId ?? null}
        emptyText={hiddenCount > 0 ? 'Chưa có module nào ngoài các module kiểm thử đang được ẩn.' : 'Chưa có module nào hoặc bạn không có quyền xem.'}
        initial={{ sort: 'moduleName' }}
        actions={(m) => (
          <>
            {can('foundation.module_version.read') && <button type="button" className="fx-btn" onClick={() => setDetail(m)}>Phiên bản</button>}
            {can(m.isEnabled ? 'foundation.module_registry.disable' : 'foundation.module_registry.enable') && (
              <button type="button" className="fx-btn" disabled={busy} onClick={() => setToggling(m)}>{m.isEnabled ? 'Tắt' : 'Bật'}</button>
            )}
          </>
        )}
      />
      {detail && (
        <Drawer kicker={`MODULE · ${detail.moduleKey}`} title={detail.moduleName} onClose={() => setDetail(null)}>
          <dl className="ms-dl">
            <dt>Trạng thái</dt><dd>{detail.isEnabled ? 'Đang bật' : 'Đang tắt'}</dd>
            <dt>Loại</dt><dd>{detail.moduleType}</dd>
            <dt>Mô tả</dt><dd>{detail.description ?? '—'}</dd>
            <dt>Cập nhật</dt><dd>{formatTime(detail.updatedAt)}</dd>
          </dl>
          <VersionPanel module={detail} onSessionLost={onSessionLost} onChanged={() => void load()}
            candidate={candidates.find((c) => c.moduleKey === detail.moduleKey && c.status !== 'INVALIDATED') ?? null}
            onOpenCandidate={(id) => onOpenPath(candidateWorkspacePath(id))} />
        </Drawer>
      )}
      {toggling && (
        <ConfirmModal
          busy={busy}
          spec={{
            title: toggling.isEnabled ? 'Tắt module' : 'Bật module', object: `${toggling.moduleName} (${toggling.moduleKey})`,
            transition: toggling.isEnabled ? 'Đang bật → Đang tắt' : 'Đang tắt → Đang bật',
            impact: toggling.isEnabled
              ? ['Menu, route và API của module ngừng phục vụ cho mọi người dùng (503 MODULE_UNAVAILABLE).', 'Phiên bản và quyền IAM giữ nguyên; có thể bật lại.']
              : ['Module phục vụ lại theo phiên bản ACTIVE và quyền IAM hiện có.', 'Kiểm tra trước: route của module không trùng module đang bật khác (fixture FBET).'],
            confirmLabel: toggling.isEnabled ? 'Tắt module' : 'Bật module', danger: toggling.isEnabled,
          }}
          onConfirm={() => void toggle(toggling)}
          onCancel={() => setToggling(null)}
        />
      )}
    </>
  );
}

function RegisterForm({ onSessionLost }: { onSessionLost: () => void }) {
  const [moduleKey, setModuleKey] = useState('');
  const [moduleName, setModuleName] = useState('');
  const [description, setDescription] = useState('');
  const [moduleType, setModuleType] = useState('INTERNAL');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const data = settle(await foundationApi.registerModule({ moduleKey: moduleKey.trim(), moduleName: moduleName.trim(), description: description.trim() || null, moduleType }),
      onSessionLost, setFeedback);
    setBusy(false);
    if (data) {
      setFeedback({ tone: 'success', text: `Đã đăng ký module ${data.moduleKey} (đang tắt). Mở “Module & Phiên bản” để xem.` });
      setModuleKey('');
      setModuleName('');
      setDescription('');
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <p className="fx-msg info">Nâng cao: cài module từ package KHÔNG cần đăng ký thủ công — chép package vào modules/, bấm Quét Module rồi Kiểm tra & Chạy thử. Form này chỉ dành cho trường hợp quản trị đặc biệt.</p>
      <p className="info">Mã module theo quy tắc K01: chữ in hoa, số và dấu gạch dưới, bắt đầu bằng chữ cái (ví dụ SALES_ORDER). Module mới luôn ở trạng thái tắt.</p>
      <FeedbackLine feedback={feedback} />
      <div className="fx-form">
        <label>Mã module<input required maxLength={80} value={moduleKey} onChange={(e) => setModuleKey(e.target.value)} placeholder="SALES_ORDER" /></label>
        <label>Tên module<input required maxLength={150} value={moduleName} onChange={(e) => setModuleName(e.target.value)} /></label>
        <label>Loại
          <select value={moduleType} onChange={(e) => setModuleType(e.target.value)}>
            <option value="INTERNAL">INTERNAL</option>
            <option value="EXTERNAL">EXTERNAL</option>
          </select>
        </label>
        <label>Mô tả<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      </div>
      <button type="submit" className="fx-btn primary" disabled={busy}>Đăng ký module</button>
    </form>
  );
}
