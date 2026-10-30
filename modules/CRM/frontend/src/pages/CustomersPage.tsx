import { useEffect, useState } from 'react';
import { Badge, Empty, Field, Modal, Pagination } from '../components/ui';
import { useAction, useCrm, useQuery, useUrlParam } from '../hooks/crm';
import type { CustomerInput, CustomerQuery } from '../services/adapter';
import type { Customer, CustomerStatus, CustomerType, IdentifierType, Province } from '../types/domain';
import { CUSTOMER_STATUS, CUSTOMER_TYPE, IDENTIFIER_TYPE, fmtDate } from '../utils/format';
import { CustomerProfile } from './CustomerProfile';

// Screen 2 — Khách hàng: list (BR-17 search / filter / stable sort / paging 20, scope applied before counting) and the
// customer profile (CustomerProfile). Create = DRAFT (D01-a); export CSV only with crm.customer.export (BR-18).

export const STATUS_TONE: Record<CustomerStatus, 'green' | 'blue' | 'amber' | 'grey' | 'violet'> = { PROSPECT: 'violet', NEW: 'blue', ACTIVE: 'green', PAUSED: 'amber', CLOSED: 'grey' };

export function RecordBadge({ c }: { c: Pick<Customer, 'recordStatus'> }) {
  return c.recordStatus === 'VERIFIED' ? <Badge tone="green">Đã xác minh</Badge> : <Badge tone="amber">DRAFT</Badge>;
}

// Address block shared by create / edit / verify forms (BR-08: province → ward of that province; foreign = free text).
export function AddressFields({ value, onChange, provinces, allowCountry }: {
  value: Pick<CustomerInput, 'addressLine' | 'provinceCode' | 'wardCode' | 'countryCode' | 'foreignLocality' | 'foreignStateProvince'>;
  onChange: (v: Partial<CustomerInput>) => void; provinces: Province[]; allowCountry: boolean;
}) {
  const vn = (value.countryCode ?? 'VN') === 'VN';
  const wards = provinces.find((p) => p.code === value.provinceCode)?.wards ?? [];
  return (
    <>
      {allowCountry && <Field label="Quốc gia (ISO 2 ký tự)"><input value={value.countryCode ?? 'VN'} maxLength={2}
        onChange={(e) => onChange({ countryCode: e.target.value.toUpperCase(), provinceCode: null, wardCode: null, foreignLocality: null, foreignStateProvince: null })} /></Field>}
      <Field label="Số nhà, tên đường"><input value={value.addressLine ?? ''} onChange={(e) => onChange({ addressLine: e.target.value })} /></Field>
      {vn ? (
        <div className="crm-row2">
          <Field label="Tỉnh / Thành phố"><select value={value.provinceCode ?? ''} onChange={(e) => onChange({ provinceCode: e.target.value || null, wardCode: null })}>
            <option value="">— Chọn —</option>{provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
          <Field label="Phường / Xã / Đặc khu"><select value={value.wardCode ?? ''} disabled={!value.provinceCode} onChange={(e) => onChange({ wardCode: e.target.value || null })}>
            <option value="">— Chọn —</option>{wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}</select></Field>
        </div>
      ) : (
        <div className="crm-row2">
          <Field label="Thành phố / địa phương"><input value={value.foreignLocality ?? ''} onChange={(e) => onChange({ foreignLocality: e.target.value })} /></Field>
          <Field label="Bang / tỉnh"><input value={value.foreignStateProvince ?? ''} onChange={(e) => onChange({ foreignStateProvince: e.target.value })} /></Field>
        </div>
      )}
    </>
  );
}

function CreateCustomer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { adapter, notify } = useCrm();
  const { run, busy } = useAction();
  const { data: provinces } = useQuery(() => adapter.provinces(), []);
  const [f, setF] = useState<CustomerInput>({ customerType: 'COMPANY', displayName: '', customerStatus: 'PROSPECT', countryCode: 'VN', legalIdentifierType: 'VN_TAX_ID' });
  const [check, setCheck] = useState<string | null>(null);
  const set = (v: Partial<CustomerInput>) => setF((x) => ({ ...x, ...v }));
  useEffect(() => {
    if (!f.legalIdentifier || !f.legalIdentifierType) { setCheck(null); return; }
    const t = setTimeout(() => {
      adapter.checkIdentity(f.legalIdentifierType as IdentifierType, f.legalIdentifier ?? '', f.countryCode ?? 'VN', f.legalName ?? f.displayName)
        .then((r) => setCheck(r.normalized === null ? 'Sai cấu trúc (MST 10 hoặc 13 chữ số, CCCD 12 chữ số).' : r.duplicate ? 'Định danh đã tồn tại — không thể tạo trùng.' : r.similarNameCount ? `Hợp lệ. Có ${r.similarNameCount} khách trùng tên (chỉ cảnh báo).` : 'Hợp lệ, chưa có trong hệ thống.'))
        .catch(() => setCheck(null));
    }, 350);
    return () => clearTimeout(t);
  }, [adapter, f.legalIdentifier, f.legalIdentifierType, f.countryCode, f.legalName, f.displayName]);
  const foreign = f.customerType === 'FOREIGN_NO_VN_REG';
  const save = () => {
    const input: CustomerInput = { ...f, legalIdentifier: f.legalIdentifier || null, legalIdentifierType: f.legalIdentifier ? f.legalIdentifierType ?? null : null };
    void run(async () => {
      const r = await adapter.createCustomer(input);
      for (const w of r.warnings) notify('info', w);
      onCreated(r.customer.customerId);
    }, 'Đã tạo hồ sơ khách hàng (DRAFT).');
  };
  return (
    <Modal title="Tạo khách hàng mới" onClose={onClose} wide footer={<>
      <button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy || !f.displayName.trim()} onClick={save}>Tạo hồ sơ DRAFT</button></>}>
      <p className="crm-note">Hồ sơ mới luôn ở trạng thái <b>DRAFT</b>. Chuyển sang <b>Đã xác minh</b> bằng chức năng "Xác minh hồ sơ" khi đủ thông tin pháp lý.</p>
      <div className="crm-form">
        <div className="crm-row2">
          <Field label="Loại khách hàng" required><select value={f.customerType} onChange={(e) => {
            const t = e.target.value as CustomerType;
            set(t === 'FOREIGN_NO_VN_REG' ? { customerType: t, countryCode: '', legalIdentifierType: 'FOREIGN_REG', provinceCode: null, wardCode: null } : { customerType: t, countryCode: 'VN', legalIdentifierType: t === 'PERSON' ? 'VN_PERSONAL_ID' : 'VN_TAX_ID' });
          }}>{Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Quan hệ"><select value={f.customerStatus} onChange={(e) => set({ customerStatus: e.target.value as CustomerStatus })}>
            {Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <Field label="Tên thường gọi" required><input value={f.displayName} onChange={(e) => set({ displayName: e.target.value })} autoFocus /></Field>
        <Field label="Tên pháp lý"><input value={f.legalName ?? ''} onChange={(e) => set({ legalName: e.target.value })} /></Field>
        <div className="crm-row2">
          <Field label="Loại định danh"><select value={f.legalIdentifierType ?? 'VN_TAX_ID'} onChange={(e) => set({ legalIdentifierType: e.target.value as IdentifierType })}>
            {Object.entries(IDENTIFIER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Số định danh" hint={check ?? 'Để trống nếu chưa có (vẫn tạo được DRAFT).'}><input value={f.legalIdentifier ?? ''} onChange={(e) => set({ legalIdentifier: e.target.value })} /></Field>
        </div>
        <div className="crm-row2">
          <Field label="Người đại diện"><input value={f.representativeName ?? ''} onChange={(e) => set({ representativeName: e.target.value })} /></Field>
          <Field label="Điện thoại người đại diện"><input value={f.representativePhone ?? ''} onChange={(e) => set({ representativePhone: e.target.value })} /></Field>
        </div>
        <AddressFields value={f} provinces={provinces ?? []} allowCountry={foreign} onChange={set} />
        <Field label="Ghi chú nội bộ"><textarea rows={2} value={f.internalNote ?? ''} onChange={(e) => set({ internalNote: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function CustomersPage() {
  const { adapter, can, accounts } = useCrm();
  const { run } = useAction();
  const deepLink = useUrlParam('customer');
  const [openId, setOpenId] = useState<string | null>(deepLink);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState<CustomerQuery>({ page: 1, pageSize: 20, sort: 'code' });
  const [term, setTerm] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ((x) => ({ ...x, q: term, page: 1 })), 300); return () => clearTimeout(t); }, [term]);
  const { data, error, loading } = useQuery(() => adapter.listCustomers(q), [JSON.stringify(q)]);
  const { data: provinces } = useQuery(() => adapter.provinces(), []);
  const { data: groups } = useQuery(() => (can('crm.group.read') ? adapter.groups() : Promise.resolve([])), [can('crm.group.read')]);
  if (openId) return <CustomerProfile customerId={openId} onBack={() => setOpenId(null)} />;
  const filter = (v: Partial<CustomerQuery>) => setQ((x) => ({ ...x, ...v, page: 1 }));
  const exportCsv = () => run(async () => {
    const csv = await adapter.exportCustomersCsv(q);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm-khach-hang-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'Đã xuất CSV theo phạm vi và bộ lọc hiện tại.');
  return (
    <div className="crm-page">
      <div className="crm-toolbar">
        <input className="crm-search" placeholder="Tìm mã, tên, tên pháp lý, MST…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Tìm khách hàng" />
        <select value={q.customerType ?? ''} onChange={(e) => filter({ customerType: e.target.value as CustomerType | '' })} aria-label="Loại khách hàng">
          <option value="">Mọi loại</option>{Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={q.customerStatus ?? ''} onChange={(e) => filter({ customerStatus: e.target.value as CustomerStatus | '' })} aria-label="Quan hệ">
          <option value="">Mọi quan hệ</option>{Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={q.recordStatus ?? ''} onChange={(e) => filter({ recordStatus: e.target.value as 'DRAFT' | 'VERIFIED' | '' })} aria-label="Hồ sơ">
          <option value="">Mọi hồ sơ</option><option value="DRAFT">DRAFT</option><option value="VERIFIED">Đã xác minh</option></select>
        <select value={q.provinceCode ?? ''} onChange={(e) => filter({ provinceCode: e.target.value })} aria-label="Tỉnh/thành">
          <option value="">Mọi tỉnh/thành</option>{(provinces ?? []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
        <select value={q.saleAccountId ?? ''} onChange={(e) => filter({ saleAccountId: e.target.value })} aria-label="Sale phụ trách">
          <option value="">Mọi Sale</option>{accounts.filter((a) => a.title.startsWith('Sale')).map((a) => <option key={a.accountId} value={a.accountId}>{a.fullName}</option>)}</select>
        {(groups ?? []).length > 0 && <select value={q.groupId ?? ''} onChange={(e) => filter({ groupId: e.target.value })} aria-label="Nhóm ngành">
          <option value="">Mọi nhóm ngành</option>{(groups ?? []).map((g) => <option key={g.groupId} value={g.groupId}>{g.groupName}</option>)}</select>}
        <select value={q.sort} onChange={(e) => setQ((x) => ({ ...x, sort: e.target.value as 'code' | 'name' | 'createdAt' }))} aria-label="Sắp xếp">
          <option value="code">Sắp theo mã</option><option value="name">Sắp theo tên</option><option value="createdAt">Mới tạo trước</option></select>
        {can('crm.customer.read_all') && <label className="crm-check"><input type="checkbox" checked={q.includeHidden === true} onChange={(e) => filter({ includeHidden: e.target.checked })} /> Gồm hồ sơ đã ẩn</label>}
        <span className="crm-grow" />
        {can('crm.customer.export') && <button type="button" className="crm-btn" onClick={exportCsv}>Xuất CSV</button>}
        {can('crm.customer.create') && <button type="button" className="crm-btn crm-primary" onClick={() => setCreating(true)}>+ Khách hàng</button>}
      </div>
      {error && <div className="crm-guard" role="alert">{error}</div>}
      {loading && !data && <Empty>Đang tải…</Empty>}
      {data && (data.items.length === 0 ? <Empty>Không có khách hàng nào trong phạm vi của bạn khớp bộ lọc.</Empty> : (
        <div className="crm-tablewrap"><table className="crm-table crm-hover">
          <thead><tr><th>Mã</th><th>Khách hàng</th><th>Loại</th><th>Định danh</th><th>Tỉnh/thành</th><th>Quan hệ</th><th>Hồ sơ</th><th>Ngày tạo</th></tr></thead>
          <tbody>{data.items.map((c) => (
            <tr key={c.customerId} tabIndex={0} onClick={() => setOpenId(c.customerId)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(c.customerId); }}>
              <td className="crm-mono">{c.customerCode}</td>
              <td><b>{c.displayName}</b>{c.legalName && <small className="crm-sub">{c.legalName}</small>}{c.isHidden && <Badge tone="grey">Đã ẩn</Badge>}</td>
              <td>{CUSTOMER_TYPE[c.customerType]}</td>
              <td className="crm-mono">{c.legalIdentifier ?? '—'}</td>
              <td>{provinces?.find((p) => p.code === c.provinceCode)?.name ?? (c.countryCode !== 'VN' ? c.countryCode : '—')}</td>
              <td><Badge tone={STATUS_TONE[c.customerStatus]}>{CUSTOMER_STATUS[c.customerStatus]}</Badge></td>
              <td><RecordBadge c={c} /></td>
              <td>{fmtDate(c.createdAt)}</td>
            </tr>))}</tbody>
        </table></div>
      ))}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ((x) => ({ ...x, page: p }))} />}
      {creating && <CreateCustomer onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </div>
  );
}
