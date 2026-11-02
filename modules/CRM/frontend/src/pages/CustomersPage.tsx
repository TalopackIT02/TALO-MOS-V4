import { useEffect, useState } from 'react';
import { Badge, Empty, Field, Modal, Pagination, PromptDialog } from '../components/ui';
import { useAction, useCrm, useQuery, useUrlParam } from '../hooks/crm';
import type { ContactInput, CustomerInput, CustomerQuery } from '../services/adapter';
import { IDENTIFIER_VIEW_PERMISSION } from '../services/adapter';
import type { Customer, CustomerStatus, CustomerType, CustomerView, IdentifierType, Province } from '../types/domain';
import { CUSTOMER_STATUS, CUSTOMER_TYPE, IDENTIFIER_TYPE, fmtDate } from '../utils/format';
import { CustomerProfile, TABS } from './CustomerProfile';
import { WorkQueueDialog, useWorkQueue } from './WorkQueue';
import type { WorkRef } from './WorkQueue';

// Screen 2 — Khách hàng (Fullstack Demo REV01 §A/§B + owner order IV.2): list with the 11 designed columns, scope applied
// before counting (BR-17), sortable headers, 10/20/50/100 per page, quickview, CSV export by permission (BR-18), and the
// 4-group create form (profile · address · contacts · sales & groups). Records are always created DRAFT (D01-a).

export const STATUS_TONE: Record<CustomerStatus, 'green' | 'blue' | 'amber' | 'grey' | 'violet'> = { PROSPECT: 'violet', NEW: 'blue', ACTIVE: 'green', PAUSED: 'amber', CLOSED: 'grey' };

export function RecordBadge({ c }: { c: Pick<Customer, 'recordStatus'> }) {
  return c.recordStatus === 'VERIFIED' ? <Badge tone="green">Đã xác minh</Badge> : <Badge tone="amber">DRAFT</Badge>;
}

type AddressValue = Pick<CustomerInput, 'addressLine' | 'provinceCode' | 'wardCode' | 'countryCode' | 'foreignLocality' | 'foreignStateProvince'>;

// Registered-address snapshot exactly as the backend builds it (read-only preview).
export function addressSnapshot(v: AddressValue, provinces: Province[]): string {
  if ((v.countryCode ?? 'VN') !== 'VN') return [v.addressLine, v.foreignLocality, v.foreignStateProvince, v.countryCode].filter(Boolean).join(', ');
  const p = provinces.find((x) => x.code === v.provinceCode);
  return [v.addressLine, p?.wards.find((w) => w.code === v.wardCode)?.name, p?.name].filter(Boolean).join(', ');
}

// Address block shared by create / edit / verify forms (BR-08: province → ward of that province; foreign = free text).
export function AddressFields({ value, onChange, provinces, allowCountry }: {
  value: AddressValue; onChange: (v: Partial<CustomerInput>) => void; provinces: Province[]; allowCountry: boolean;
}) {
  const vn = (value.countryCode ?? 'VN') === 'VN';
  const wards = provinces.find((p) => p.code === value.provinceCode)?.wards ?? [];
  const snapshot = addressSnapshot(value, provinces);
  return (
    <>
      {allowCountry && !vn && <Field label="Quốc gia (ISO 2 ký tự)" required><input value={value.countryCode ?? ''} maxLength={2}
        onChange={(e) => onChange({ countryCode: e.target.value.toUpperCase() })} /></Field>}
      {vn ? (
        <div className="crm-row2">
          <Field label="Tỉnh / Thành phố"><select value={value.provinceCode ?? ''} onChange={(e) => onChange({ provinceCode: e.target.value || null, wardCode: null })}>
            <option value="">— Chọn —</option>{provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
          <Field label="Phường / Xã / Đặc khu" hint={value.provinceCode ? undefined : 'Chọn tỉnh/thành trước'}>
            <select value={value.wardCode ?? ''} disabled={!value.provinceCode} onChange={(e) => onChange({ wardCode: e.target.value || null })}>
              <option value="">— Chọn —</option>{wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}</select></Field>
        </div>
      ) : (
        <div className="crm-row2">
          <Field label="Thành phố / địa phương"><input value={value.foreignLocality ?? ''} onChange={(e) => onChange({ foreignLocality: e.target.value })} /></Field>
          <Field label="Bang / tỉnh"><input value={value.foreignStateProvince ?? ''} onChange={(e) => onChange({ foreignStateProvince: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Số nhà, tên đường"><input value={value.addressLine ?? ''} onChange={(e) => onChange({ addressLine: e.target.value })} /></Field>
      <Field label="Địa chỉ đăng ký (tự tạo, chỉ đọc)"><input value={snapshot} readOnly aria-readonly="true" className="crm-readonly" /></Field>
    </>
  );
}

const emptyContact = (): ContactInput => ({ fullName: '', positionTitle: '', phone: '', zaloPhone: '', email: '', isPrimary: false });

function CreateCustomer({ onClose, onCreated, onOpenExisting }: { onClose: () => void; onCreated: (id: string) => void; onOpenExisting: (id: string) => void }) {
  const { adapter, notify, can, accounts } = useCrm();
  const { run, busy } = useAction();
  const { data: provinces } = useQuery(() => adapter.provinces(), []);
  const { data: groups } = useQuery(() => (can('crm.group.read') ? adapter.groups() : Promise.resolve([])), []);
  const [f, setF] = useState<CustomerInput>({ customerType: 'COMPANY', displayName: '', customerStatus: 'PROSPECT', countryCode: 'VN', legalIdentifierType: 'VN_TAX_ID' });
  const [contacts, setContacts] = useState<ContactInput[]>([]);
  const [primary, setPrimary] = useState('');
  const [supports, setSupports] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [check, setCheck] = useState<{ text: string; tone: 'ok' | 'warn' | 'err'; existingId: string | null } | null>(null);
  const [confirmForeign, setConfirmForeign] = useState<boolean | null>(null);
  const set = (v: Partial<CustomerInput>) => setF((x) => ({ ...x, ...v }));
  const foreign = (f.countryCode ?? 'VN') !== 'VN';
  const sales = accounts.filter((a) => a.active && a.title.startsWith('Sale'));
  // Live identity check (BR-06): duplicates block; same name only warns; an existing record is offered only if visible.
  useEffect(() => {
    if (!f.legalIdentifier || !f.legalIdentifierType) { setCheck(null); return; }
    const t = setTimeout(() => {
      adapter.checkIdentity(f.legalIdentifierType as IdentifierType, f.legalIdentifier ?? '', f.countryCode || 'VN', f.legalName || f.displayName)
        .then(async (r) => {
          if (r.normalized === null) return setCheck({ text: 'Sai cấu trúc (MST 10 hoặc 13 chữ số, CCCD 12 chữ số).', tone: 'err', existingId: null });
          if (r.duplicate) {
            const visible = await adapter.visibleCustomers();
            const hit = visible.find((c) => c.legalIdentifier === r.normalized);
            return setCheck({ text: 'Định danh đã tồn tại — không thể tạo trùng (409).', tone: 'err', existingId: hit?.customerId ?? null });
          }
          return setCheck(r.similarNameCount ? { text: `Hợp lệ. Có ${r.similarNameCount} khách trùng tên (chỉ cảnh báo).`, tone: 'warn', existingId: null }
            : { text: 'Hợp lệ, chưa có trong hệ thống.', tone: 'ok', existingId: null });
        }).catch(() => setCheck(null));
    }, 350);
    return () => clearTimeout(t);
  }, [adapter, f.legalIdentifier, f.legalIdentifierType, f.countryCode, f.legalName, f.displayName]);
  const toggleForeign = (toForeign: boolean) => {
    const hasAddress = !!(f.addressLine || f.provinceCode || f.wardCode || f.foreignLocality || f.foreignStateProvince);
    if (hasAddress) { setConfirmForeign(toForeign); return; }
    applyForeign(toForeign);
  };
  const applyForeign = (toForeign: boolean) => {
    set(toForeign ? { countryCode: '', provinceCode: null, wardCode: null, addressLine: null, legalIdentifierType: 'FOREIGN_REG' }
      : { countryCode: 'VN', foreignLocality: null, foreignStateProvince: null, addressLine: null, legalIdentifierType: 'VN_TAX_ID', ...(f.customerType === 'FOREIGN_NO_VN_REG' ? { customerType: 'COMPANY' as CustomerType } : {}) });
    setConfirmForeign(null);
  };
  const save = (verify: boolean) => {
    const customer: CustomerInput = { ...f, legalIdentifier: f.legalIdentifier || null, legalIdentifierType: f.legalIdentifier ? f.legalIdentifierType ?? null : null };
    const cts = contacts.map((c) => ({ ...c, positionTitle: c.positionTitle || null, phone: c.phone || null, zaloPhone: c.zaloPhone || null, email: c.email || null }));
    void run(async () => {
      const r = await adapter.createCustomerFull({ customer, contacts: cts, primarySaleAccountId: primary || null, supportSaleAccountIds: supports, groupIds, verify });
      for (const w of r.warnings) notify('info', w);
      onCreated(r.customer.customerId);
    }, verify ? 'Đã tạo và xác minh hồ sơ khách hàng (VERIFIED).' : 'Đã lưu hồ sơ khách hàng (DRAFT).');
  };
  const setContact = (i: number, v: Partial<ContactInput>) => setContacts((cs) => cs.map((c, j) => (j === i ? { ...c, ...v } : v.isPrimary ? { ...c, isPrimary: false } : c)));
  return (
    <Modal title="Tạo khách hàng mới" onClose={onClose} wide footer={<>
      <button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn" disabled={busy || !f.displayName.trim()} onClick={() => save(false)}>Lưu Draft</button>
      {can('crm.customer.verify') && <button type="button" className="crm-btn crm-primary" disabled={busy || !f.displayName.trim()} onClick={() => save(true)}>Lưu và xác minh</button>}</>}>
      <p className="crm-note">Hồ sơ được tạo ở trạng thái <b>DRAFT</b>. "Lưu và xác minh" chỉ thành công khi đủ thông tin pháp lý và địa chỉ (D01-a); thiếu thì không lưu gì (toàn bộ hoặc không gì).</p>
      <div className="crm-form">
        <fieldset className="crm-group"><legend>1. Hồ sơ</legend>
          <div className="crm-row2">
            <Field label="Loại khách hàng" required><select value={f.customerType} onChange={(e) => {
              const t = e.target.value as CustomerType;
              if (t === 'FOREIGN_NO_VN_REG' && !foreign) { set({ customerType: t }); toggleForeign(true); return; }
              set({ customerType: t, ...(t === 'PERSON' && !foreign ? { legalIdentifierType: 'VN_PERSONAL_ID' as IdentifierType } : {}) });
            }}>{Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Quan hệ hợp tác"><select value={f.customerStatus} onChange={(e) => set({ customerStatus: e.target.value as CustomerStatus })}>
              {Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          <div className="crm-row2">
            <Field label="Tên thường gọi" required><input value={f.displayName} onChange={(e) => set({ displayName: e.target.value })} autoFocus /></Field>
            <Field label="Tên pháp lý"><input value={f.legalName ?? ''} onChange={(e) => set({ legalName: e.target.value })} /></Field>
          </div>
          <div className="crm-row2">
            <Field label="Loại định danh"><select value={f.legalIdentifierType ?? 'VN_TAX_ID'} onChange={(e) => set({ legalIdentifierType: e.target.value as IdentifierType })}>
              {Object.entries(IDENTIFIER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Số định danh" hint={check ? undefined : 'Để trống nếu chưa có (vẫn lưu được DRAFT).'}>
              <input value={f.legalIdentifier ?? ''} onChange={(e) => set({ legalIdentifier: e.target.value })} aria-describedby="crm-id-check" />
              {check && <small id="crm-id-check" className={`crm-check-${check.tone}`}>{check.text}
                {check.existingId && <> <button type="button" className="crm-link" onClick={() => onOpenExisting(check.existingId ?? '')}>Mở hồ sơ đã có</button></>}</small>}
            </Field>
          </div>
          <div className="crm-row2">
            <Field label="Người đại diện"><input value={f.representativeName ?? ''} onChange={(e) => set({ representativeName: e.target.value })} /></Field>
            <Field label="Điện thoại người đại diện"><input value={f.representativePhone ?? ''} onChange={(e) => set({ representativePhone: e.target.value })} /></Field>
          </div>
        </fieldset>
        <fieldset className="crm-group"><legend>2. Địa chỉ đăng ký</legend>
          <label className="crm-check"><input type="checkbox" checked={foreign} onChange={(e) => toggleForeign(e.target.checked)} /> Khách hàng nước ngoài (địa chỉ ngoài Việt Nam)</label>
          <AddressFields value={f} provinces={provinces ?? []} allowCountry onChange={set} />
        </fieldset>
        <fieldset className="crm-group"><legend>3. Người liên hệ ({contacts.length})</legend>
          {!can('crm.contact.manage') ? <small>Bạn không có quyền quản lý người liên hệ (thêm sau trong hồ sơ).</small> : <>
            {contacts.map((c, i) => (
              <div className="crm-contact-row" key={i}>
                <input placeholder="Họ tên *" aria-label={`Họ tên liên hệ ${i + 1}`} value={c.fullName} onChange={(e) => setContact(i, { fullName: e.target.value })} />
                <input placeholder="Chức vụ" aria-label={`Chức vụ liên hệ ${i + 1}`} value={c.positionTitle ?? ''} onChange={(e) => setContact(i, { positionTitle: e.target.value })} />
                <input placeholder="Điện thoại" aria-label={`Điện thoại liên hệ ${i + 1}`} value={c.phone ?? ''} onChange={(e) => setContact(i, { phone: e.target.value })} />
                <input placeholder="Zalo" aria-label={`Zalo liên hệ ${i + 1}`} value={c.zaloPhone ?? ''} onChange={(e) => setContact(i, { zaloPhone: e.target.value })} />
                <input placeholder="Email" aria-label={`Email liên hệ ${i + 1}`} value={c.email ?? ''} onChange={(e) => setContact(i, { email: e.target.value })} />
                <label className="crm-check"><input type="radio" name="crm-primary-contact" checked={c.isPrimary ?? false} onChange={() => setContact(i, { isPrimary: true })} /> Chính</label>
                <button type="button" className="crm-x" aria-label={`Bỏ liên hệ ${i + 1}`} onClick={() => setContacts((cs) => cs.filter((_, j) => j !== i))}>×</button>
              </div>))}
            <button type="button" className="crm-btn crm-sm" onClick={() => setContacts((cs) => [...cs, emptyContact()])}>+ Thêm người liên hệ</button>
            <small>Mỗi người liên hệ cần điện thoại hoặc Zalo; chức vụ không bắt buộc.</small>
          </>}
        </fieldset>
        <fieldset className="crm-group"><legend>4. Sale phụ trách và nhóm ngành</legend>
          {can('crm.assignment.manage') ? (
            <div className="crm-row2">
              <Field label="Sale chính"><select value={primary} onChange={(e) => { setPrimary(e.target.value); setSupports((s) => s.filter((x) => x !== e.target.value)); }}>
                <option value="">— Chưa phân công —</option>{sales.map((a) => <option key={a.accountId} value={a.accountId}>{a.fullName}</option>)}</select></Field>
              <div className="crm-field"><span>Sale hỗ trợ</span><div className="crm-checklist">{sales.filter((a) => a.accountId !== primary).map((a) =>
                <label key={a.accountId}><input type="checkbox" checked={supports.includes(a.accountId)} onChange={() => setSupports((s) => (s.includes(a.accountId) ? s.filter((x) => x !== a.accountId) : [...s, a.accountId]))} /> {a.fullName}</label>)}</div></div>
            </div>
          ) : <p className="crm-note crm-warn">Bạn không có quyền phân công. <b>Giải pháp tạm của bản mô phỏng (FE-G01, chưa được duyệt):</b> người tạo được ghi nhận là Sale chính để có thể mở lại hồ sơ. Backend REV01 chưa có quy tắc này.</p>}
          {can('crm.group.assign') && (groups ?? []).length > 0 && <div className="crm-field"><span>Nhóm ngành</span><div className="crm-checklist">{(groups ?? []).filter((g) => g.isActive).map((g) =>
            <label key={g.groupId}><input type="checkbox" checked={groupIds.includes(g.groupId)} onChange={() => setGroupIds((s) => (s.includes(g.groupId) ? s.filter((x) => x !== g.groupId) : [...s, g.groupId]))} /> {g.groupName}</label>)}</div></div>}
        </fieldset>
      </div>
      {confirmForeign !== null && <Modal title="Đổi loại địa chỉ" onClose={() => setConfirmForeign(null)} footer={<>
        <button type="button" className="crm-btn" onClick={() => setConfirmForeign(null)}>Giữ nguyên</button>
        <button type="button" className="crm-btn crm-danger" onClick={() => applyForeign(confirmForeign)}>Đổi và xóa địa chỉ đã nhập</button></>}>
        <p>Chuyển sang địa chỉ {confirmForeign ? 'nước ngoài' : 'Việt Nam'} sẽ xóa địa chỉ đang nhập. Tiếp tục?</p>
      </Modal>}
    </Modal>
  );
}

// Quick view (REV01 §A): open / edit / hide according to permissions. Hide = soft hide, never a hard delete.
function QuickView({ c, onClose, onOpen }: { c: CustomerView; onClose: () => void; onOpen: () => void }) {
  const { accountName, can, adapter } = useCrm();
  const { run } = useAction();
  const [hiding, setHiding] = useState(false);
  if (hiding) return <PromptDialog title="Ẩn hồ sơ khách hàng" label="Ghi chú (không bắt buộc)" required={false} confirm="Ẩn hồ sơ" danger onCancel={onClose}
    onConfirm={() => run(() => adapter.hideCustomer(c.customerId), 'Đã ẩn hồ sơ. Hồ sơ vẫn được tính khi kiểm tra trùng định danh.')} />;
  return (
    <Modal title={`${c.customerCode} — ${c.displayName}`} onClose={onClose} footer={<>
      <button type="button" className="crm-btn" onClick={onClose}>Đóng</button>
      {can('crm.customer.hide') && !c.isHidden && <button type="button" className="crm-btn crm-danger" onClick={() => setHiding(true)}>Ẩn hồ sơ</button>}
      <button type="button" className="crm-btn crm-primary" onClick={onOpen}>{can('crm.customer.update') ? 'Mở hồ sơ / Sửa' : 'Mở hồ sơ'}</button></>}>
      <dl className="crm-dl">
        <dt>Tên pháp lý</dt><dd>{c.legalName ?? '—'}</dd>
        <dt>Loại</dt><dd>{CUSTOMER_TYPE[c.customerType]}</dd>
        <dt>{c.legalIdentifierType ? IDENTIFIER_TYPE[c.legalIdentifierType] : 'Định danh'}</dt><dd className="crm-mono">{c.legalIdentifier ?? '—'}{c.identifierMasked && <small className="crm-sub">Đã che theo quyền</small>}</dd>
        <dt>Trạng thái</dt><dd><Badge tone={STATUS_TONE[c.customerStatus]}>{CUSTOMER_STATUS[c.customerStatus]}</Badge> <RecordBadge c={c} />{c.isHidden && <> <Badge tone="grey">Đã ẩn</Badge></>}</dd>
        <dt>Sale chính</dt><dd>{accountName(c.primarySaleAccountId)}</dd>
        <dt>Sale hỗ trợ</dt><dd>{c.supportSaleAccountIds.map((id) => accountName(id)).join(', ') || '—'}</dd>
        <dt>Địa chỉ</dt><dd>{c.registeredAddress ?? c.addressLine ?? '—'}</dd>
      </dl>
    </Modal>
  );
}

type SortKey = 'code' | 'name' | 'createdAt';

export function CustomersPage() {
  const { adapter, can, accounts } = useCrm();
  const { run } = useAction();
  const deepLink = useUrlParam('customer');
  const deepTab = useUrlParam('tab');
  const initialTab = TABS.find((t) => t === deepTab);
  const [openId, setOpenId] = useState<string | null>(deepLink);
  const deepHandover = useUrlParam('handover');
  const deepLegal = useUrlParam('legal');
  const [work, setWork] = useState<{ initial: WorkRef | null } | null>(() =>
    deepHandover ? { initial: { kind: 'handover', id: deepHandover } } : deepLegal ? { initial: { kind: 'legal', id: deepLegal } } : null);
  const queue = useWorkQueue();
  const workDialog = work && <WorkQueueDialog initial={work.initial} onClose={() => setWork(null)} onOpenCustomer={(id) => { setWork(null); setOpenId(id); }} />;
  const [quick, setQuick] = useState<CustomerView | null>(null);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [q, setQ] = useState<CustomerQuery>({ page: 1, pageSize: 20, sort: 'code', sortDir: 'asc' });
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ((x) => ({ ...x, q: term, page: 1 })), 300); return () => clearTimeout(t); }, [term]);
  const { data, error, loading } = useQuery(() => adapter.listCustomers(q), [JSON.stringify(q), refresh]);
  const { data: provinces } = useQuery(() => adapter.provinces(), []);
  const { data: regions } = useQuery(() => adapter.regions(), []);
  const { data: groups } = useQuery(() => (can('crm.group.read') ? adapter.groups() : Promise.resolve([])), [can('crm.group.read')]);
  if (openId) return <><CustomerProfile customerId={openId} onBack={() => setOpenId(null)} {...(openId === deepLink && initialTab ? { initialTab } : {})} />{workDialog}</>;
  const filter = (v: Partial<CustomerQuery>) => setQ((x) => ({ ...x, ...v, page: 1 }));
  const sortBy = (k: SortKey) => setQ((x) => ({ ...x, sort: k, sortDir: x.sort === k && x.sortDir === 'asc' ? 'desc' : 'asc', page: 1 }));
  const arrow = (k: SortKey) => (q.sort === k ? (q.sortDir === 'desc' ? ' ▼' : ' ▲') : '');
  const ariaSort = (k: SortKey) => (q.sort === k ? (q.sortDir === 'desc' ? 'descending' : 'ascending') : 'none');
  const regionName = (code: string | null) => regions?.regions.find((r) => r.code === code)?.name ?? null;
  const macroName = (code: string | null) => regions?.macroRegions.find((r) => r.code === code)?.name ?? null;
  const exportCsv = () => run(async () => {
    const csv = await adapter.exportCustomersCsv(q);
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })); // BOM: Excel reads Vietnamese (REV01 §G)
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-khach-hang-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'Đã xuất CSV theo phạm vi và bộ lọc hiện tại.');
  const reset = () => { setTerm(''); setQ({ page: 1, pageSize: q.pageSize ?? 20, sort: 'code', sortDir: 'asc' }); };
  return (
    <div className="crm-page">
      <div className="crm-toolbar">
        <input className="crm-search" placeholder={can(IDENTIFIER_VIEW_PERMISSION) ? 'Tìm mã, tên, tên pháp lý, MST…' : 'Tìm mã, tên, tên pháp lý…'}
          title={can(IDENTIFIER_VIEW_PERMISSION) ? undefined : 'Tìm theo định danh pháp lý cần quyền xem định danh đầy đủ (đề xuất OD-05).'} value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Tìm khách hàng" />
        <span className="crm-grow" />
        <button type="button" className="crm-btn" onClick={() => setRefresh((r) => r + 1)} aria-label="Làm mới danh sách">⟳ Làm mới</button>
        {(queue.count > 0 || can('crm.assignment.read') || can('crm.legal_change.approve_management') || can('crm.legal_change.approve_accounting')) &&
          <button type="button" className="crm-btn" onClick={() => setWork({ initial: null })}>Chờ xử lý ({queue.count})</button>}
        {can('crm.customer.export') && <button type="button" className="crm-btn" onClick={exportCsv}>Xuất CSV</button>}
        {can('crm.customer.create') && <button type="button" className="crm-btn crm-primary" onClick={() => setCreating(true)}>+ Khách hàng</button>}
      </div>
      <div className="crm-toolbar crm-filters">
        <select value={q.customerType ?? ''} onChange={(e) => filter({ customerType: e.target.value as CustomerType | '' })} aria-label="Loại khách hàng">
          <option value="">Mọi loại</option>{Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={q.customerStatus ?? ''} onChange={(e) => filter({ customerStatus: e.target.value as CustomerStatus | '' })} aria-label="Quan hệ">
          <option value="">Mọi quan hệ</option>{Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={q.recordStatus ?? ''} onChange={(e) => filter({ recordStatus: e.target.value as 'DRAFT' | 'VERIFIED' | '' })} aria-label="Hồ sơ">
          <option value="">Mọi hồ sơ</option><option value="DRAFT">DRAFT</option><option value="VERIFIED">Đã xác minh</option></select>
        <select value={q.macroRegionCode ?? ''} onChange={(e) => filter({ macroRegionCode: e.target.value })} aria-label="Miền">
          <option value="">Mọi miền</option>{(regions?.macroRegions ?? []).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select>
        <select value={q.regionCode ?? ''} onChange={(e) => filter({ regionCode: e.target.value })} aria-label="Vùng kinh tế">
          <option value="">Mọi vùng kinh tế</option>{(regions?.regions ?? []).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select>
        <select value={q.provinceCode ?? ''} onChange={(e) => filter({ provinceCode: e.target.value })} aria-label="Tỉnh/thành">
          <option value="">Mọi tỉnh/thành</option>{(provinces ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
        <select value={q.saleAccountId ?? ''} onChange={(e) => filter({ saleAccountId: e.target.value })} aria-label="Sale phụ trách">
          <option value="">{q.saleRole ? 'Tôi' : 'Mọi Sale'}</option>{accounts.filter((a) => a.title.startsWith('Sale')).map((a) => <option key={a.accountId} value={a.accountId}>{a.fullName}</option>)}</select>
        <select value={q.saleRole ?? ''} onChange={(e) => filter({ saleRole: e.target.value as 'PRIMARY' | 'SUPPORT' | '' })} aria-label="Vai trò Sale">
          <option value="">Chính hoặc hỗ trợ</option><option value="PRIMARY">Là Sale chính</option><option value="SUPPORT">Là Sale hỗ trợ</option></select>
        {(groups ?? []).length > 0 && <select value={q.groupId ?? ''} onChange={(e) => filter({ groupId: e.target.value })} aria-label="Nhóm ngành">
          <option value="">Mọi nhóm ngành</option>{(groups ?? []).map((g) => <option key={g.groupId} value={g.groupId}>{g.groupName}</option>)}</select>}
        {can('crm.customer.read_all') && <label className="crm-check"><input type="checkbox" checked={q.includeHidden === true} onChange={(e) => filter({ includeHidden: e.target.checked })} /> Gồm hồ sơ đã ẩn</label>}
        <button type="button" className="crm-link" onClick={reset}>Xóa bộ lọc</button>
      </div>
      {error && <div className="crm-guard" role="alert">{error}</div>}
      {loading && !data && <Empty>Đang tải danh sách…</Empty>}
      {data && (data.items.length === 0 ? <Empty>Không có khách hàng nào trong phạm vi của bạn khớp bộ lọc.</Empty> : (
        <div className="crm-tablewrap"><table className="crm-table crm-hover">
          <thead><tr>
            <th aria-sort={ariaSort('code')}><button type="button" className="crm-sort" onClick={() => sortBy('code')}>Mã KH{arrow('code')}</button></th>
            <th aria-sort={ariaSort('name')}><button type="button" className="crm-sort" onClick={() => sortBy('name')}>Tên thường gọi{arrow('name')}</button></th>
            <th>Tên pháp lý</th><th>Định danh</th><th>Loại</th><th>Tỉnh / Quốc gia</th><th>Miền / Vùng</th><th>Quan hệ</th><th>Hồ sơ</th><th>Sale chính</th>
            <th aria-sort={ariaSort('createdAt')}><button type="button" className="crm-sort" onClick={() => sortBy('createdAt')}>Ngày tạo{arrow('createdAt')}</button></th>
            <th>Thao tác</th>
          </tr></thead>
          <tbody>{data.items.map((c) => (
            <tr key={c.customerId}>
              <td className="crm-mono">{c.customerCode}</td>
              <td><button type="button" className="crm-link crm-name-link" onClick={() => setQuick(c)}>{c.displayName}</button>{c.isHidden && <> <Badge tone="grey">Đã ẩn</Badge></>}</td>
              <td>{c.legalName ?? '—'}</td>
              <td className="crm-mono" title={c.identifierMasked ? 'Đã che theo quyền (đề xuất OD-05)' : undefined}>{c.legalIdentifier ?? '—'}</td>
              <td>{CUSTOMER_TYPE[c.customerType]}</td>
              <td>{provinces?.find((p) => p.code === c.provinceCode)?.name ?? (c.countryCode !== 'VN' ? c.countryCode : '—')}</td>
              <td>{macroName(c.macroRegionCode) ?? '—'}{c.regionCode && <small className="crm-sub">{regionName(c.regionCode)}</small>}</td>
              <td><Badge tone={STATUS_TONE[c.customerStatus]}>{CUSTOMER_STATUS[c.customerStatus]}</Badge></td>
              <td><RecordBadge c={c} /></td>
              <td>{c.primarySaleAccountId ? accounts.find((a) => a.accountId === c.primarySaleAccountId)?.fullName ?? '—' : '—'}
                {c.supportSaleAccountIds.length > 0 && <small className="crm-sub">+{c.supportSaleAccountIds.length} hỗ trợ</small>}</td>
              <td>{fmtDate(c.createdAt)}</td>
              <td className="crm-actions"><button type="button" className="crm-btn crm-sm" onClick={() => setOpenId(c.customerId)}>Xem hồ sơ</button></td>
            </tr>))}</tbody>
        </table></div>
      ))}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ((x) => ({ ...x, page: p }))}
        onPageSize={(n) => setQ((x) => ({ ...x, pageSize: n, page: 1 }))} />}
      {quick && <QuickView c={quick} onClose={() => setQuick(null)} onOpen={() => { setOpenId(quick.customerId); setQuick(null); }} />}
      {creating && <CreateCustomer onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }}
        onOpenExisting={(id) => { setCreating(false); setOpenId(id); }} />}
      {workDialog}
    </div>
  );
}
