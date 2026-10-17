import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { foundationApi } from '../../services/foundation/foundationApi';
import type { ModuleRecord } from '../../services/foundation/foundationApi';
import { FeedbackLine, formatTime, settle } from './common';
import type { Feedback, ScreenProps } from './common';
import { VersionPanel } from './VersionPanel';

// FE-03 — Module Registry: list (GET /foundation/modules), registration (POST), ENABLE / DISABLE (lifecycle API) and the
// versions of the selected module. Tab 0 = list + versions, tab 1 = registration form.

export function ModuleScreen({ tab, onSessionLost }: ScreenProps) {
  const [modules, setModules] = useState<ModuleRecord[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (tab === 1) {
    return <RegisterForm onSessionLost={onSessionLost} onRegistered={(m) => { setSelectedId(m.moduleId); void load(); }} />;
  }

  const selected = modules?.find((m) => m.moduleId === selectedId) ?? null;
  return (
    <>
      <div className="fx-toolbar">
        <button type="button" className="fx-btn" onClick={() => void load()}>Tải lại</button>
        <span className="muted">Dữ liệu lấy trực tiếp từ Foundation Backend.</span>
      </div>
      <FeedbackLine feedback={feedback} />
      {modules === null ? <p className="info">Đang tải…</p> : modules.length === 0 ? <p className="info">Chưa có module nào hoặc bạn không có quyền xem.</p> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Mã module</th><th>Tên</th><th>Loại</th><th>Trạng thái</th><th>Cập nhật</th><th /></tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.moduleId} className={m.moduleId === selectedId ? 'fx-selected' : undefined}>
                  <td><b>{m.moduleKey}</b></td>
                  <td>{m.moduleName}</td>
                  <td>{m.moduleType}</td>
                  <td><span className={m.isEnabled ? 'tag fx-status-active' : 'tag'}>{m.isEnabled ? 'Đang bật' : 'Đang tắt'}</span></td>
                  <td>{formatTime(m.updatedAt)}</td>
                  <td>
                    <div className="fx-toolbar" style={{ marginBottom: 0 }}>
                      <button type="button" className="fx-btn" onClick={() => setSelectedId(m.moduleId)}>Phiên bản</button>
                      <button type="button" className="fx-btn" disabled={busy} onClick={() => void toggle(m)}>{m.isEnabled ? 'Tắt' : 'Bật'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <VersionPanel key={selected.moduleId} module={selected} onSessionLost={onSessionLost} onChanged={() => void load()} />}
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
