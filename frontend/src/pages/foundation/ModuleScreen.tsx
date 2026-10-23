import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { foundationApi } from '../../services/foundation/foundationApi';
import type { ModuleRecord } from '../../services/foundation/foundationApi';
import { FeedbackLine, formatTime, settle } from './common';
import type { Feedback, ScreenProps } from './common';
import { VersionPanel } from './VersionPanel';
import { DataTable, NameCode } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import { useShellData } from '../../contexts/ShellData';
import { ModuleScanButton, ModuleScanResults, SCAN_PERMISSIONS, useModuleScan } from './ModuleScan';
import { ModuleInstaller } from './ModuleInstaller';
import type { CandidateRequest } from './ModuleInstaller';

// FE-03 — Module Registry: list (GET /foundation/modules), registration (POST), ENABLE / DISABLE (lifecycle API) and the
// versions of the selected module. Tab 0 = list + versions (+ FMI-01 "Quét Module"), tab 1 = registration form.

const isTestModule = (m: ModuleRecord) => m.moduleKey.startsWith('FBET_');

// WS03 / WS04: name first, technical code muted; description shown as the note of the module.
const MODULE_COLUMNS: Column<ModuleRecord>[] = [
  { key: 'moduleName', label: 'Module', value: (m) => `${m.moduleName} ${m.moduleKey}`, render: (m) => <NameCode name={m.moduleName} code={m.moduleKey} /> },
  { key: 'description', label: 'Mô tả', value: (m) => m.description ?? '', render: (m) => m.description ?? <span className="muted">—</span> },
  { key: 'moduleType', label: 'Loại', value: (m) => m.moduleType },
  { key: 'isEnabled', label: 'Trạng thái', value: (m) => (m.isEnabled ? 'Đang bật' : 'Đang tắt'), render: (m) => <span className={m.isEnabled ? 'tag fx-status-active' : 'tag'}>{m.isEnabled ? 'Đang bật' : 'Đang tắt'}</span> },
  { key: 'updatedAt', label: 'Cập nhật', value: (m) => m.updatedAt, render: (m) => formatTime(m.updatedAt), searchable: false },
];

export function ModuleScreen({ tab, onSessionLost }: ScreenProps) {
  const [modules, setModules] = useState<ModuleRecord[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTestModules, setShowTestModules] = useState(false);
  const versionsRef = useRef<HTMLDivElement>(null);
  const { can } = useShellData();
  // FMI-01: manual module scan — shown only with BOTH registry permissions (the server checks them again).
  const canScan = SCAN_PERMISSIONS.every((p) => can(p));
  const scanner = useModuleScan(onSessionLost);
  // FMI-02 / FMI-03: candidate requested from a scanned package; install buttons need foundation.module_version.activate
  // (the server checks every permission again, and each lifecycle step checks its own).
  const [candidateRequest, setCandidateRequest] = useState<CandidateRequest | null>(null);
  const canInstall = can('foundation.module_version.activate');

  const load = useCallback(async () => {
    const data = settle(await foundationApi.listModules(), onSessionLost, setFeedback);
    setModules(data ?? []);
  }, [onSessionLost]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(module: ModuleRecord) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const result = module.isEnabled ? await foundationApi.disableModule(module.moduleId) : await foundationApi.enableModule(module.moduleId);
    const data = settle(result, onSessionLost, setFeedback);
    if (data) setFeedback({ tone: 'success', text: `Module ${data.moduleKey} đã ${data.isEnabled ? 'bật' : 'tắt'}.` });
    await load();
    setBusy(false);
  }

  // The version area sits above the list: choosing a module brings it into view.
  function choose(moduleId: string) {
    setSelectedId(moduleId);
    versionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (tab === 1) {
    return <RegisterForm onSessionLost={onSessionLost} onRegistered={(m) => { setSelectedId(m.moduleId); void load(); }} />;
  }

  // Display filter only (the API data is unchanged): integration-test fixtures (FBET_*) are hidden unless asked for.
  const hiddenCount = showTestModules ? 0 : (modules ?? []).filter(isTestModule).length;
  const visible = modules === null ? null : showTestModules ? modules : modules.filter((m) => !isTestModule(m));
  const selected = visible?.find((m) => m.moduleId === selectedId) ?? null;
  return (
    <>
      <div className="fx-toolbar">
        <button type="button" className="fx-btn" onClick={() => void load()}>Tải lại</button>
        {canScan && <ModuleScanButton loading={scanner.state.kind === 'LOADING'} onScan={() => void scanner.scan()} />}
        <label className="muted"><input type="checkbox" checked={showTestModules} onChange={(e) => setShowTestModules(e.target.checked)} /> Hiện module kiểm thử</label>
        {hiddenCount > 0 && <span className="muted">Đang ẩn {hiddenCount} module kiểm thử (FBET_).</span>}
        <span className="muted">Dữ liệu lấy trực tiếp từ Foundation Backend.</span>
      </div>
      <FeedbackLine feedback={feedback} />
      {canScan && <ModuleScanResults state={scanner.state} lastScanId={scanner.lastScanId} onReopen={() => void scanner.reopen()}
        onPreflight={(scanId, moduleKey) => setCandidateRequest({ scanId, moduleKey, nonce: Date.now() })} />}
      {canScan && <ModuleInstaller request={candidateRequest} canInstall={canInstall} onSessionLost={onSessionLost} />}
      <div ref={versionsRef} className="fx-version-area">
        {selected
          ? <VersionPanel key={selected.moduleId} module={selected} onSessionLost={onSessionLost} onChanged={() => void load()} />
          : <p className="fx-placeholder">Chọn một Module trong danh sách bên dưới để quản lý phiên bản.</p>}
      </div>
      <DataTable
        label="module"
        columns={MODULE_COLUMNS}
        rows={visible}
        rowKey={(m) => m.moduleId}
        selectedKey={selectedId}
        emptyText={hiddenCount > 0 ? 'Chưa có module nào ngoài các module kiểm thử đang được ẩn.' : 'Chưa có module nào hoặc bạn không có quyền xem.'}
        initial={{ sort: 'moduleName' }}
        actions={(m) => (
          <>
            {can('foundation.module_version.read') && <button type="button" className="fx-btn" onClick={() => choose(m.moduleId)}>Phiên bản</button>}
            {can(m.isEnabled ? 'foundation.module_registry.disable' : 'foundation.module_registry.enable') && (
              <button type="button" className="fx-btn" disabled={busy} onClick={() => void toggle(m)}>{m.isEnabled ? 'Tắt' : 'Bật'}</button>
            )}
          </>
        )}
      />
    </>
  );
}

function RegisterForm({ onSessionLost, onRegistered }: { onSessionLost: () => void; onRegistered: (m: ModuleRecord) => void }) {
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
      setFeedback({ tone: 'success', text: `Đã đăng ký module ${data.moduleKey} (đang tắt). Chọn tab “Module & Phiên bản” để tạo phiên bản.` });
      setModuleKey('');
      setModuleName('');
      setDescription('');
      onRegistered(data);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
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
