import { useState } from 'react';
import { AppointmentDetail, AppointmentForm, TaskForm, TaskRows } from '../components/forms';
import { Badge, Empty, Field, Modal, PromptDialog } from '../components/ui';
import { useAction, useCrm, useQuery } from '../hooks/crm';
import type { ActivityInput, CustomerBundle, CustomerInput, DocumentInput } from '../services/adapter';
import type { Activity, Appointment, Contact, CrmDocument, CustomerType, Handover, IdentifierType, LegalChange } from '../types/domain';
import {
  ACTIVITY_TYPE, APPOINTMENT_STATUS, CUSTOMER_STATUS, CUSTOMER_TYPE, DOCUMENT_TYPE, HANDOVER_STATUS, IDENTIFIER_TYPE, LEGAL_STATUS, expiry, fileSize, fmtDate,
  fmtDateTime, fromLocalInput, toLocalInput,
} from '../utils/format';
import { AddressFields, RecordBadge, STATUS_TONE } from './CustomersPage';

// Customer profile — left 1/3: identity, legal data and responsible sales (+ the sensitive actions, by permission);
// right 2/3: tabs Tổng quan · Thông tin liên hệ · Lịch hẹn · Công việc · Hoạt động & Kết quả · Tài liệu.

const TABS = ['Tổng quan', 'Thông tin liên hệ', 'Lịch hẹn', 'Công việc', 'Hoạt động & Kết quả', 'Tài liệu'] as const;

export function CustomerProfile({ customerId, onBack }: { customerId: string; onBack: () => void }) {
  const { adapter } = useCrm();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tổng quan');
  const { data: b, error } = useQuery(() => adapter.customerBundle(customerId), [customerId]);
  if (error) return <div className="crm-page"><button type="button" className="crm-link" onClick={onBack}>← Danh sách khách hàng</button><div className="crm-guard" role="alert">{error}</div></div>;
  if (!b) return <Empty>Đang tải hồ sơ…</Empty>;
  return (
    <div className="crm-page">
      <button type="button" className="crm-link" onClick={onBack}>← Danh sách khách hàng</button>
      <div className="crm-profile">
        <aside className="crm-profile-left"><LeftPanel b={b} /></aside>
        <section className="crm-profile-right">
          <div className="crm-subtabs" role="tablist">{TABS.map((t) => <button type="button" role="tab" aria-selected={tab === t} key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
          <div className="crm-tabbody">
            {tab === 'Tổng quan' && <OverviewTab b={b} />}
            {tab === 'Thông tin liên hệ' && <ContactsTab b={b} />}
            {tab === 'Lịch hẹn' && <AppointmentsTab b={b} />}
            {tab === 'Công việc' && <TasksTab b={b} />}
            {tab === 'Hoạt động & Kết quả' && <ActivitiesTab b={b} />}
            {tab === 'Tài liệu' && <DocumentsTab b={b} />}
          </div>
        </section>
      </div>
    </div>
  );
}

// ================================================================================================ left panel
function LeftPanel({ b }: { b: CustomerBundle }) {
  const { adapter, can, accountName, session } = useCrm();
  const { run } = useAction();
  const { data: provinces } = useQuery(() => adapter.provinces(), []);
  const { data: groups } = useQuery(() => (can('crm.group.read') ? adapter.groups() : Promise.resolve([])), []);
  const [dlg, setDlg] = useState<null | 'edit' | 'verify' | 'legal' | 'assign' | 'handover' | 'groups' | 'hide'>(null);
  const c = b.customer;
  const me = session?.account.accountId;
  const active = b.assignments.filter((a) => a.endedAt === null);
  const primary = active.find((a) => a.role === 'PRIMARY');
  const pendingLegal = b.legalChanges.find((l) => l.status === 'PENDING_MANAGEMENT' || l.status === 'PENDING_ACCOUNTING');
  const openHandover = b.handovers.find((h) => ['PENDING_APPROVAL', 'PENDING_CURRENT_ACK', 'PENDING_RECEIVER_ACK'].includes(h.status));
  const province = provinces?.find((p) => p.code === c.provinceCode);
  return (
    <>
      <div className="crm-card">
        <div className="crm-idhead"><span className="crm-mono">{c.customerCode}</span><RecordBadge c={c} />
          <Badge tone={STATUS_TONE[c.customerStatus]}>{CUSTOMER_STATUS[c.customerStatus]}</Badge>{c.isHidden && <Badge tone="grey">Đã ẩn</Badge>}</div>
        <h2 className="crm-name">{c.displayName}</h2>
        <dl className="crm-dl">
          <dt>Tên pháp lý</dt><dd>{c.legalName ?? '—'}</dd>
          <dt>Loại</dt><dd>{CUSTOMER_TYPE[c.customerType]}</dd>
          <dt>{c.legalIdentifierType ? IDENTIFIER_TYPE[c.legalIdentifierType] : 'Định danh'}</dt><dd className="crm-mono">{c.legalIdentifier ?? '—'}</dd>
          <dt>Địa chỉ</dt><dd>{c.registeredAddress ?? ([c.addressLine, province?.name].filter(Boolean).join(', ') || '—')}</dd>
          <dt>Quốc gia</dt><dd>{c.countryCode}</dd>
          <dt>Đại diện</dt><dd>{c.representativeName ?? '—'}{c.representativePhone && <small className="crm-sub">{c.representativePhone}</small>}</dd>
        </dl>
        {c.recordStatus === 'DRAFT' && <p className="crm-note">Hồ sơ DRAFT: chưa dùng được cho nghiệp vụ yêu cầu hồ sơ đã xác minh.</p>}
        <div className="crm-btnrow">
          {can('crm.customer.update') && <button type="button" className="crm-btn crm-sm" onClick={() => setDlg('edit')}>Sửa thông tin</button>}
          {c.recordStatus === 'DRAFT' && can('crm.customer.verify') && <button type="button" className="crm-btn crm-sm crm-primary" onClick={() => setDlg('verify')}>Xác minh hồ sơ</button>}
          {c.recordStatus === 'VERIFIED' && can('crm.legal_change.request') && !pendingLegal && <button type="button" className="crm-btn crm-sm" onClick={() => setDlg('legal')}>Đề nghị đổi pháp lý</button>}
          {can('crm.customer.hide') && !c.isHidden && <button type="button" className="crm-btn crm-sm" onClick={() => setDlg('hide')}>Ẩn hồ sơ</button>}
        </div>
      </div>

      {pendingLegal && <LegalBox l={pendingLegal} />}

      <div className="crm-card">
        <h3>Sale phụ trách</h3>
        {primary ? <p><Badge tone="green">Sale chính</Badge> <b>{accountName(primary.saleAccountId)}</b> <small className="crm-sub">từ {fmtDate(primary.assignedAt)}</small></p> : <p className="crm-empty">Chưa có Sale chính.</p>}
        {active.filter((a) => a.role === 'SUPPORT').map((a) => (
          <p key={a.assignmentId}><Badge tone="blue">Hỗ trợ</Badge> {accountName(a.saleAccountId)}
            {can('crm.assignment.manage') && <button type="button" className="crm-link" onClick={() => run(() => adapter.endAssignment(a.assignmentId), 'Đã kết thúc phân công hỗ trợ.')}>Kết thúc</button>}</p>
        ))}
        <div className="crm-btnrow">
          {can('crm.assignment.manage') && <button type="button" className="crm-btn crm-sm" onClick={() => setDlg('assign')}>Phân công Sale</button>}
          {can('crm.handover.request') && primary && !openHandover && (primary.saleAccountId === me || can('crm.handover.approve'))
            && <button type="button" className="crm-btn crm-sm" onClick={() => setDlg('handover')}>Yêu cầu bàn giao</button>}
        </div>
        {openHandover && <HandoverBox h={openHandover} />}
        {b.assignments.some((a) => a.endedAt) && <details className="crm-history"><summary>Lịch sử phân công</summary>
          {b.assignments.filter((a) => a.endedAt).map((a) => <p key={a.assignmentId}>{a.role === 'PRIMARY' ? 'Sale chính' : 'Hỗ trợ'}: {accountName(a.saleAccountId)} ({fmtDate(a.assignedAt)} – {fmtDate(a.endedAt)})</p>)}
        </details>}
      </div>

      {can('crm.group.read') && <div className="crm-card">
        <h3>Nhóm ngành</h3>
        <div className="crm-chips">{c.groupIds.length === 0 ? <small>Chưa gắn nhóm.</small> : c.groupIds.map((id) => <span key={id} className="crm-chip">{groups?.find((g) => g.groupId === id)?.groupName ?? id}</span>)}</div>
        {(can('crm.group.assign') || can('crm.group.manage')) && <button type="button" className="crm-btn crm-sm" onClick={() => setDlg('groups')}>Cập nhật nhóm</button>}
      </div>}

      {dlg === 'edit' && <EditCustomer b={b} onClose={() => setDlg(null)} />}
      {dlg === 'verify' && <VerifyCustomer b={b} onClose={() => setDlg(null)} />}
      {dlg === 'legal' && <LegalChangeDialog b={b} onClose={() => setDlg(null)} />}
      {dlg === 'assign' && <AssignDialog b={b} onClose={() => setDlg(null)} />}
      {dlg === 'handover' && <HandoverDialog b={b} onClose={() => setDlg(null)} />}
      {dlg === 'groups' && <GroupsDialog b={b} onClose={() => setDlg(null)} />}
      {dlg === 'hide' && <PromptDialog title="Ẩn hồ sơ khách hàng" label="Ghi chú (không bắt buộc)" required={false} confirm="Ẩn hồ sơ" danger onCancel={() => setDlg(null)}
        onConfirm={() => run(() => adapter.hideCustomer(c.customerId), 'Đã ẩn hồ sơ. Hồ sơ vẫn được tính khi kiểm tra trùng định danh.')} />}
    </>
  );
}

export function LegalBox({ l }: { l: LegalChange }) {
  const { adapter, can, accountName } = useCrm();
  const { run } = useAction();
  const [reject, setReject] = useState(false);
  const stage = l.status === 'PENDING_MANAGEMENT' ? 'MANAGEMENT' : 'ACCOUNTING';
  const allowed = stage === 'MANAGEMENT' ? can('crm.legal_change.approve_management') : can('crm.legal_change.approve_accounting');
  const row = (label: string, a: string | null, b: string) => a !== b && <tr><td>{label}</td><td>{a ?? '—'}</td><td><b>{b}</b></td></tr>;
  return (
    <div className="crm-card crm-pending">
      <h3>Yêu cầu thay đổi pháp lý <Badge tone="amber">{LEGAL_STATUS[l.status]}</Badge></h3>
      <p><small>{accountName(l.requestedByAccountId)} · {fmtDateTime(l.requestedAt)}</small></p>
      <p>{l.reason}</p>
      <table className="crm-table crm-compact"><thead><tr><th /><th>Hiện hành</th><th>Đề nghị</th></tr></thead><tbody>
        {row('Tên pháp lý', l.oldLegalName, l.newLegalName)}{row('Loại', CUSTOMER_TYPE[l.oldCustomerType], CUSTOMER_TYPE[l.newCustomerType])}
        {row('Định danh', l.oldIdentifier, l.newIdentifier)}{row('Quốc gia', l.oldCountryCode, l.newCountryCode)}
      </tbody></table>
      {l.decisions.map((d) => <p key={d.stage}><small>{d.stage === 'MANAGEMENT' ? 'Quản lý' : 'Kế toán'}: {d.decision === 'APPROVED' ? 'Đồng ý' : 'Từ chối'} — {accountName(d.decidedByAccountId)}</small></p>)}
      {allowed && <div className="crm-btnrow">
        <button type="button" className="crm-btn crm-sm crm-primary" onClick={() => run(() => adapter.decideLegalChange(l.changeRequestId, stage, 'APPROVED'),
          stage === 'MANAGEMENT' ? 'Đã duyệt cấp quản lý — chờ kế toán.' : 'Đã duyệt cấp kế toán — thông tin pháp lý đã được cập nhật.')}>Duyệt ({stage === 'MANAGEMENT' ? 'quản lý' : 'kế toán'})</button>
        <button type="button" className="crm-btn crm-sm" onClick={() => setReject(true)}>Từ chối</button>
      </div>}
      {reject && <PromptDialog title="Từ chối yêu cầu thay đổi pháp lý" label="Lý do từ chối" confirm="Từ chối" danger onCancel={() => setReject(false)}
        onConfirm={(t) => run(() => adapter.decideLegalChange(l.changeRequestId, stage, 'REJECTED', t), 'Đã từ chối yêu cầu.')} />}
    </div>
  );
}

export function HandoverBox({ h }: { h: Handover }) {
  const { adapter, can, accountName, session, accounts } = useCrm();
  const { run } = useAction();
  const [dlg, setDlg] = useState<null | 'reject' | 'override'>(null);
  const me = session?.account.accountId;
  const currentInactive = accounts.find((a) => a.accountId === h.currentSaleAccountId)?.active === false;
  const canReject = can('crm.handover.reject') && ((h.status === 'PENDING_APPROVAL' && can('crm.handover.approve'))
    || (h.status === 'PENDING_CURRENT_ACK' && h.currentSaleAccountId === me) || (h.status === 'PENDING_RECEIVER_ACK' && h.toSaleAccountId === me));
  return (
    <div className="crm-pending crm-inner">
      <p><b>Bàn giao:</b> {accountName(h.currentSaleAccountId)} → {accountName(h.toSaleAccountId)} <Badge tone="amber">{HANDOVER_STATUS[h.status]}</Badge></p>
      <p><small>{h.mode === 'MANAGER_INITIATED' ? 'Luồng A — quản lý yêu cầu' : 'Luồng B — Sale đề nghị'} · {accountName(h.initiatedByAccountId)} · {fmtDateTime(h.requestedAt)}</small></p>
      {h.note && <p><small>{h.note}</small></p>}
      <div className="crm-btnrow">
        {h.status === 'PENDING_APPROVAL' && can('crm.handover.approve') && <button type="button" className="crm-btn crm-sm crm-primary" onClick={() => run(() => adapter.approveHandover(h.handoverId), 'Đã duyệt bàn giao — chờ Sale nhận xác nhận.')}>Duyệt bàn giao</button>}
        {h.status === 'PENDING_CURRENT_ACK' && h.currentSaleAccountId === me && can('crm.handover.acknowledge') && <button type="button" className="crm-btn crm-sm crm-primary" onClick={() => run(() => adapter.acknowledgeHandover(h.handoverId), 'Đã xác nhận bàn giao.')}>Xác nhận (Sale hiện tại)</button>}
        {h.status === 'PENDING_CURRENT_ACK' && currentInactive && can('crm.handover.override') && <button type="button" className="crm-btn crm-sm" onClick={() => setDlg('override')}>Xác nhận thay (Sale đã nghỉ)</button>}
        {h.status === 'PENDING_RECEIVER_ACK' && h.toSaleAccountId === me && can('crm.handover.acknowledge') && <button type="button" className="crm-btn crm-sm crm-primary" onClick={() => run(() => adapter.acknowledgeHandover(h.handoverId), 'Đã nhận bàn giao: bạn là Sale chính, công việc đang mở đã được chuyển.')}>Nhận bàn giao</button>}
        {canReject && <button type="button" className="crm-btn crm-sm" onClick={() => setDlg('reject')}>Từ chối</button>}
      </div>
      {dlg === 'reject' && <PromptDialog title="Từ chối bàn giao" label="Lý do từ chối" confirm="Từ chối" danger onCancel={() => setDlg(null)} onConfirm={(t) => run(() => adapter.rejectHandover(h.handoverId, t), 'Đã từ chối bàn giao.')} />}
      {dlg === 'override' && <PromptDialog title="Xác nhận thay Sale hiện tại" label="Lý do (Sale cũ không còn khả năng xác nhận)" confirm="Xác nhận thay" onCancel={() => setDlg(null)} onConfirm={(t) => run(() => adapter.acknowledgeHandover(h.handoverId, t), 'Đã xác nhận thay — chờ Sale nhận.')} />}
    </div>
  );
}

function EditCustomer({ b, onClose }: { b: CustomerBundle; onClose: () => void }) {
  const { adapter } = useCrm();
  const { run, busy } = useAction();
  const { data: provinces } = useQuery(() => adapter.provinces(), []);
  const c = b.customer;
  const [f, setF] = useState<Partial<CustomerInput>>({ displayName: c.displayName, customerStatus: c.customerStatus, representativeName: c.representativeName,
    representativePhone: c.representativePhone, addressLine: c.addressLine, provinceCode: c.provinceCode, wardCode: c.wardCode, countryCode: c.countryCode,
    foreignLocality: c.foreignLocality, foreignStateProvince: c.foreignStateProvince, internalNote: c.internalNote });
  const save = () => run(() => adapter.updateCustomer(c.customerId, { displayName: f.displayName ?? '', customerStatus: f.customerStatus ?? c.customerStatus,
    representativeName: f.representativeName ?? null, representativePhone: f.representativePhone ?? null, addressLine: f.addressLine ?? null, provinceCode: f.provinceCode ?? null,
    wardCode: f.wardCode ?? null, foreignLocality: f.foreignLocality ?? null, foreignStateProvince: f.foreignStateProvince ?? null, internalNote: f.internalNote ?? null }),
  'Đã cập nhật hồ sơ.').then((ok) => { if (ok) onClose(); });
  return (
    <Modal title="Sửa thông tin khách hàng" onClose={onClose} wide footer={<><button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy} onClick={save}>Lưu</button></>}>
      <p className="crm-note">Tên pháp lý, định danh, loại khách hàng và quốc gia không sửa tại đây{c.recordStatus === 'VERIFIED' ? ' — dùng "Đề nghị đổi pháp lý" (duyệt 2 cấp).' : ' — hoàn thiện khi "Xác minh hồ sơ".'}</p>
      <div className="crm-form">
        <div className="crm-row2">
          <Field label="Tên thường gọi" required><input value={f.displayName ?? ''} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
          <Field label="Quan hệ"><select value={f.customerStatus} onChange={(e) => setF({ ...f, customerStatus: e.target.value as CustomerInput['customerStatus'] })}>
            {Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <div className="crm-row2">
          <Field label="Người đại diện"><input value={f.representativeName ?? ''} onChange={(e) => setF({ ...f, representativeName: e.target.value })} /></Field>
          <Field label="Điện thoại người đại diện"><input value={f.representativePhone ?? ''} onChange={(e) => setF({ ...f, representativePhone: e.target.value })} /></Field>
        </div>
        <AddressFields value={f} provinces={provinces ?? []} allowCountry={false} onChange={(v) => setF({ ...f, ...v })} />
        <Field label="Ghi chú nội bộ"><textarea rows={2} value={f.internalNote ?? ''} onChange={(e) => setF({ ...f, internalNote: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function VerifyCustomer({ b, onClose }: { b: CustomerBundle; onClose: () => void }) {
  const { adapter } = useCrm();
  const { run, busy } = useAction();
  const { data: provinces } = useQuery(() => adapter.provinces(), []);
  const c = b.customer;
  const [f, setF] = useState<Partial<CustomerInput>>({ customerType: c.customerType, legalName: c.legalName ?? c.displayName, legalIdentifierType: c.legalIdentifierType ?? (c.customerType === 'FOREIGN_NO_VN_REG' ? 'FOREIGN_REG' : 'VN_TAX_ID'),
    legalIdentifier: c.legalIdentifier, addressLine: c.addressLine, provinceCode: c.provinceCode, wardCode: c.wardCode, countryCode: c.countryCode, foreignLocality: c.foreignLocality, foreignStateProvince: c.foreignStateProvince });
  const save = () => run(() => adapter.verifyCustomer(c.customerId, f), 'Hồ sơ đã được xác minh (VERIFIED).').then((ok) => { if (ok) onClose(); });
  return (
    <Modal title="Xác minh hồ sơ khách hàng" onClose={onClose} wide footer={<><button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy} onClick={save}>Xác minh</button></>}>
      <p className="crm-note">Cần đủ: tên pháp lý, định danh hợp lệ, số nhà/đường và (khách Việt Nam) tỉnh/thành + phường/xã thuộc tỉnh. Định danh trùng sẽ bị chặn.</p>
      <div className="crm-form">
        <div className="crm-row2">
          <Field label="Loại khách hàng"><select value={f.customerType} onChange={(e) => setF({ ...f, customerType: e.target.value as CustomerType })}>
            {Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Tên pháp lý" required><input value={f.legalName ?? ''} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></Field>
        </div>
        <div className="crm-row2">
          <Field label="Loại định danh" required><select value={f.legalIdentifierType ?? 'VN_TAX_ID'} onChange={(e) => setF({ ...f, legalIdentifierType: e.target.value as IdentifierType })}>
            {Object.entries(IDENTIFIER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Số định danh" required><input value={f.legalIdentifier ?? ''} onChange={(e) => setF({ ...f, legalIdentifier: e.target.value })} /></Field>
        </div>
        <AddressFields value={f} provinces={provinces ?? []} allowCountry={f.customerType === 'FOREIGN_NO_VN_REG'} onChange={(v) => setF({ ...f, ...v })} />
      </div>
    </Modal>
  );
}

function LegalChangeDialog({ b, onClose }: { b: CustomerBundle; onClose: () => void }) {
  const { adapter } = useCrm();
  const { run, busy } = useAction();
  const c = b.customer;
  const [f, setF] = useState({ reason: '', evidenceDocumentId: b.documents[0]?.documentId ?? '', newLegalName: c.legalName ?? '', newCustomerType: c.customerType,
    newIdentifierType: c.legalIdentifierType ?? 'VN_TAX_ID' as IdentifierType, newIdentifier: c.legalIdentifier ?? '', newCountryCode: c.countryCode });
  const save = () => run(() => adapter.requestLegalChange(c.customerId, f), 'Đã gửi yêu cầu — chờ quản lý duyệt, sau đó kế toán duyệt.').then((ok) => { if (ok) onClose(); });
  return (
    <Modal title="Đề nghị thay đổi thông tin pháp lý" onClose={onClose} wide footer={<><button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy || !f.reason.trim() || !f.evidenceDocumentId} onClick={save}>Gửi yêu cầu</button></>}>
      <p className="crm-note">Thông tin hiện hành chưa thay đổi cho đến khi quản lý và kế toán cùng duyệt. Người đề nghị không được tự duyệt.</p>
      <div className="crm-form">
        <Field label="Tên pháp lý mới" required><input value={f.newLegalName} onChange={(e) => setF({ ...f, newLegalName: e.target.value })} /></Field>
        <div className="crm-row2">
          <Field label="Loại khách hàng"><select value={f.newCustomerType} onChange={(e) => setF({ ...f, newCustomerType: e.target.value as CustomerType })}>
            {Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Quốc gia"><input value={f.newCountryCode} maxLength={2} onChange={(e) => setF({ ...f, newCountryCode: e.target.value.toUpperCase() })} /></Field>
        </div>
        <div className="crm-row2">
          <Field label="Loại định danh"><select value={f.newIdentifierType} onChange={(e) => setF({ ...f, newIdentifierType: e.target.value as IdentifierType })}>
            {Object.entries(IDENTIFIER_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Số định danh mới" required><input value={f.newIdentifier} onChange={(e) => setF({ ...f, newIdentifier: e.target.value })} /></Field>
        </div>
        <Field label="Chứng từ (tài liệu của khách hàng này)" required>
          <select value={f.evidenceDocumentId} onChange={(e) => setF({ ...f, evidenceDocumentId: e.target.value })}>
            <option value="">— Chọn tài liệu —</option>{b.documents.map((d) => <option key={d.documentId} value={d.documentId}>{d.documentName} ({d.fileName})</option>)}</select>
        </Field>
        <Field label="Lý do" required><textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function AssignDialog({ b, onClose }: { b: CustomerBundle; onClose: () => void }) {
  const { adapter, accounts } = useCrm();
  const { run, busy } = useAction();
  const hasPrimary = b.assignments.some((a) => a.endedAt === null && a.role === 'PRIMARY');
  const taken = new Set(b.assignments.filter((a) => a.endedAt === null).map((a) => a.saleAccountId));
  const [f, setF] = useState({ saleAccountId: '', role: hasPrimary ? 'SUPPORT' as const : 'PRIMARY' as 'PRIMARY' | 'SUPPORT' });
  return (
    <Modal title="Phân công Sale" onClose={onClose} footer={<><button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy || !f.saleAccountId} onClick={() => run(() => adapter.addAssignment(b.customer.customerId, f.saleAccountId, f.role), 'Đã phân công.').then((ok) => { if (ok) onClose(); })}>Phân công</button></>}>
      <div className="crm-form">
        <Field label="Vai trò"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'PRIMARY' | 'SUPPORT' })}>
          <option value="SUPPORT">Sale hỗ trợ</option><option value="PRIMARY" disabled={hasPrimary}>Sale chính{hasPrimary ? ' (đã có — dùng bàn giao)' : ''}</option></select></Field>
        <Field label="Sale"><select value={f.saleAccountId} onChange={(e) => setF({ ...f, saleAccountId: e.target.value })}>
          <option value="">— Chọn —</option>{accounts.filter((a) => a.active && !taken.has(a.accountId)).map((a) => <option key={a.accountId} value={a.accountId}>{a.fullName} — {a.title}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

function HandoverDialog({ b, onClose }: { b: CustomerBundle; onClose: () => void }) {
  const { adapter, accounts, can, session } = useCrm();
  const { run, busy } = useAction();
  const primary = b.assignments.find((a) => a.endedAt === null && a.role === 'PRIMARY');
  const mine = primary?.saleAccountId === session?.account.accountId;
  const [f, setF] = useState({ mode: mine ? 'SALE_INITIATED' as const : 'MANAGER_INITIATED' as 'SALE_INITIATED' | 'MANAGER_INITIATED', to: '', note: '' });
  return (
    <Modal title="Yêu cầu bàn giao khách hàng" onClose={onClose} footer={<><button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy || !f.to} onClick={() => run(() => adapter.requestHandover(b.customer.customerId, f.mode, f.to, f.note || null), 'Đã tạo yêu cầu bàn giao.').then((ok) => { if (ok) onClose(); })}>Gửi yêu cầu</button></>}>
      <div className="crm-form">
        <Field label="Luồng"><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as 'SALE_INITIATED' | 'MANAGER_INITIATED' })}>
          <option value="SALE_INITIATED" disabled={!mine}>B — Sale hiện tại đề nghị → Quản lý duyệt → Sale nhận xác nhận</option>
          <option value="MANAGER_INITIATED" disabled={!can('crm.handover.approve')}>A — Quản lý yêu cầu → Sale hiện tại xác nhận → Sale nhận xác nhận</option></select></Field>
        <Field label="Sale nhận"><select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
          <option value="">— Chọn —</option>{accounts.filter((a) => a.active && a.accountId !== primary?.saleAccountId && a.title.startsWith('Sale')).map((a) => <option key={a.accountId} value={a.accountId}>{a.fullName}</option>)}</select></Field>
        <Field label="Ghi chú"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <p className="crm-note">Khi hoàn tất: Sale nhận trở thành Sale chính; chỉ công việc đang mở của Sale cũ được chuyển; lịch sử được giữ.</p>
    </Modal>
  );
}

function GroupsDialog({ b, onClose }: { b: CustomerBundle; onClose: () => void }) {
  const { adapter, can } = useCrm();
  const { run, busy } = useAction();
  const { data: groups } = useQuery(() => adapter.groups(), []);
  const [sel, setSel] = useState<string[]>(b.customer.groupIds);
  const [n, setN] = useState({ groupCode: '', groupName: '', parentGroupId: '' });
  return (
    <Modal title="Nhóm ngành của khách hàng" onClose={onClose} footer={<><button type="button" className="crm-btn" onClick={onClose}>Đóng</button>
      {can('crm.group.assign') && <button type="button" className="crm-btn crm-primary" disabled={busy} onClick={() => run(() => adapter.setCustomerGroups(b.customer.customerId, sel), 'Đã cập nhật nhóm ngành.').then((ok) => { if (ok) onClose(); })}>Lưu nhóm</button>}</>}>
      <div className="crm-links">{(groups ?? []).filter((g) => g.isActive).map((g) => <label key={g.groupId}><input type="checkbox" disabled={!can('crm.group.assign')} checked={sel.includes(g.groupId)}
        onChange={() => setSel(sel.includes(g.groupId) ? sel.filter((x) => x !== g.groupId) : [...sel, g.groupId])} /> {g.groupName} <small>({g.groupCode})</small></label>)}</div>
      {can('crm.group.manage') && <fieldset className="crm-links"><legend>Thêm nhóm ngành mới (quyền quản lý danh mục)</legend>
        <div className="crm-row3">
          <input placeholder="Mã (VD: PKG)" value={n.groupCode} onChange={(e) => setN({ ...n, groupCode: e.target.value })} />
          <input placeholder="Tên nhóm" value={n.groupName} onChange={(e) => setN({ ...n, groupName: e.target.value })} />
          <select value={n.parentGroupId} onChange={(e) => setN({ ...n, parentGroupId: e.target.value })}><option value="">Không có nhóm cha</option>
            {(groups ?? []).map((g) => <option key={g.groupId} value={g.groupId}>{g.groupName}</option>)}</select>
        </div>
        <button type="button" className="crm-btn crm-sm" disabled={!n.groupCode || !n.groupName} onClick={() => run(() => adapter.createGroup({ ...n, parentGroupId: n.parentGroupId || null }), 'Đã tạo nhóm ngành.').then((ok) => { if (ok) setN({ groupCode: '', groupName: '', parentGroupId: '' }); })}>Tạo nhóm</button>
      </fieldset>}
    </Modal>
  );
}

// ======================================================================================================= tabs
function OverviewTab({ b }: { b: CustomerBundle }) {
  const { accountName } = useCrm();
  const now = new Date().toISOString();
  const next = b.appointments.filter((a) => a.status === 'SCHEDULED' && a.endAt >= now).slice(0, 3);
  const openTasks = b.tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS');
  const overdue = openTasks.filter((t) => t.dueAt !== null && t.dueAt < now);
  const docs = b.documents.filter((d) => ['EXPIRED', 'EXPIRING_SOON'].includes(expiry(d.expiryDate).status) && !b.documents.some((n) => n.supersedesDocumentId === d.documentId));
  return (
    <div className="crm-overview">
      <div className="crm-kpis">
        <div className="crm-kpi"><b>{next.length}</b><span>Lịch hẹn sắp tới</span></div>
        <div className="crm-kpi"><b>{openTasks.length}</b><span>Công việc chưa xong</span></div>
        <div className={`crm-kpi${overdue.length ? ' crm-kpi-red' : ''}`}><b>{overdue.length}</b><span>Quá hạn</span></div>
        <div className={`crm-kpi${docs.length ? ' crm-kpi-amber' : ''}`}><b>{docs.length}</b><span>Tài liệu sắp/đã hết hạn</span></div>
      </div>
      <h4>Lịch hẹn sắp tới</h4>
      {next.length === 0 ? <Empty>Chưa có lịch hẹn sắp tới.</Empty> : next.map((a) => <p key={a.appointmentId}>📅 {fmtDateTime(a.startAt)} — {a.title} <small>({accountName(a.ownerAccountId)})</small></p>)}
      <h4>Hoạt động gần đây</h4>
      {b.activities.length === 0 ? <Empty>Chưa có hoạt động.</Empty> : b.activities.slice(0, 5).map((a) => <p key={a.activityId}><Badge tone="grey">{ACTIVITY_TYPE[a.activityType]}</Badge> {fmtDateTime(a.occurredAt)} — {a.title}</p>)}
    </div>
  );
}

function ContactsTab({ b }: { b: CustomerBundle }) {
  const { adapter, can } = useCrm();
  const { run } = useAction();
  const [edit, setEdit] = useState<Contact | 'new' | null>(null);
  return (
    <>
      <div className="crm-toolbar"><span className="crm-grow" />{can('crm.contact.manage') && <button type="button" className="crm-btn crm-primary crm-sm" onClick={() => setEdit('new')}>+ Người liên hệ</button>}</div>
      {!can('crm.contact.read') ? <Empty>Bạn không có quyền xem người liên hệ.</Empty> : b.contacts.length === 0 ? <Empty>Chưa có người liên hệ.</Empty> : (
        <div className="crm-tablewrap"><table className="crm-table"><thead><tr><th>Họ tên</th><th>Chức vụ</th><th>Điện thoại</th><th>Zalo</th><th>Email</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{b.contacts.map((ct) => <tr key={ct.contactId} className={ct.isActive ? '' : 'crm-muted'}>
            <td><b>{ct.fullName}</b> {ct.isPrimary && ct.isActive && <Badge tone="green">Chính</Badge>}</td><td>{ct.positionTitle ?? '—'}</td><td>{ct.phone ?? '—'}</td><td>{ct.zaloPhone ?? '—'}</td>
            <td>{ct.email ?? '—'}</td><td>{ct.isActive ? 'Đang dùng' : 'Ngừng dùng'}</td>
            <td className="crm-actions">{can('crm.contact.manage') && ct.isActive && <><button type="button" className="crm-btn crm-sm" onClick={() => setEdit(ct)}>Sửa</button>
              <button type="button" className="crm-btn crm-sm" onClick={() => run(() => adapter.deactivateContact(ct.contactId), 'Đã ngừng sử dụng liên hệ.')}>Ngừng dùng</button></>}</td>
          </tr>)}</tbody></table></div>
      )}
      {edit && <ContactForm customerId={b.customer.customerId} contact={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ContactForm({ customerId, contact, onClose }: { customerId: string; contact?: Contact; onClose: () => void }) {
  const { adapter } = useCrm();
  const { run, busy } = useAction();
  const [f, setF] = useState({ fullName: contact?.fullName ?? '', positionTitle: contact?.positionTitle ?? '', phone: contact?.phone ?? '', zaloPhone: contact?.zaloPhone ?? '', email: contact?.email ?? '', isPrimary: contact?.isPrimary ?? false });
  const save = () => run(async () => {
    const input = { fullName: f.fullName, positionTitle: f.positionTitle || null, phone: f.phone || null, zaloPhone: f.zaloPhone || null, email: f.email || null, isPrimary: f.isPrimary };
    if (contact) await adapter.updateContact(contact.contactId, input); else await adapter.createContact(customerId, input);
  }, 'Đã lưu người liên hệ.').then((ok) => { if (ok) onClose(); });
  return (
    <Modal title={contact ? 'Sửa người liên hệ' : 'Thêm người liên hệ'} onClose={onClose} footer={<><button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy} onClick={save}>Lưu</button></>}>
      <div className="crm-form">
        <div className="crm-row2"><Field label="Họ tên" required><input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoFocus /></Field>
          <Field label="Chức vụ"><input value={f.positionTitle} onChange={(e) => setF({ ...f, positionTitle: e.target.value })} /></Field></div>
        <div className="crm-row2"><Field label="Điện thoại" hint="Cần điện thoại hoặc Zalo"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Zalo"><input value={f.zaloPhone} onChange={(e) => setF({ ...f, zaloPhone: e.target.value })} /></Field></div>
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <label className="crm-check"><input type="checkbox" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} /> Người liên hệ chính</label>
      </div>
    </Modal>
  );
}

function AppointmentsTab({ b }: { b: CustomerBundle }) {
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<Appointment | null>(null);
  const { accountName } = useCrm();
  return (
    <>
      <div className="crm-toolbar"><small>Lịch hẹn của khách hàng này — cùng dữ liệu với màn hình Lịch hẹn.</small><span className="crm-grow" />
        <button type="button" className="crm-btn crm-primary crm-sm" onClick={() => setForm(true)}>+ Lịch hẹn</button></div>
      {b.appointments.length === 0 ? <Empty>Chưa có lịch hẹn.</Empty> : (
        <div className="crm-tablewrap"><table className="crm-table crm-hover"><thead><tr><th>Thời gian</th><th>Tiêu đề</th><th>Địa điểm</th><th>Người phụ trách</th><th>Trạng thái</th></tr></thead>
          <tbody>{b.appointments.map((a) => <tr key={a.appointmentId} tabIndex={0} onClick={() => setOpen(a)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(a); }}>
            <td>{fmtDateTime(a.startAt)}</td><td>{a.title}</td><td>{a.location ?? '—'}</td><td>{accountName(a.ownerAccountId)}</td>
            <td><Badge tone={a.status === 'SCHEDULED' ? 'blue' : a.status === 'DONE' ? 'green' : 'grey'}>{APPOINTMENT_STATUS[a.status]}</Badge></td></tr>)}</tbody></table></div>
      )}
      {form && <AppointmentForm customerId={b.customer.customerId} onClose={() => setForm(false)} />}
      {open && <AppointmentDetail appointment={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function TasksTab({ b }: { b: CustomerBundle }) {
  const [form, setForm] = useState(false);
  return (
    <>
      <div className="crm-toolbar"><small>Công việc gắn khách hàng này — cùng dữ liệu với màn hình Công việc.</small><span className="crm-grow" />
        <button type="button" className="crm-btn crm-primary crm-sm" onClick={() => setForm(true)}>+ Công việc</button></div>
      {b.tasks.length === 0 ? <Empty>Chưa có công việc.</Empty> : <TaskRows tasks={b.tasks} showCustomer={false} />}
      {form && <TaskForm customerId={b.customer.customerId} onClose={() => setForm(false)} />}
    </>
  );
}

function ActivitiesTab({ b }: { b: CustomerBundle }) {
  const { adapter, can, accountName } = useCrm();
  const { run } = useAction();
  const [form, setForm] = useState<Activity | 'new' | null>(null);
  return (
    <>
      <div className="crm-toolbar"><small>Nhật ký tiếp xúc và kết quả (cm_customer_activities).</small><span className="crm-grow" />
        {can('crm.activity.create') && <button type="button" className="crm-btn crm-primary crm-sm" onClick={() => setForm('new')}>+ Ghi nhận hoạt động</button>}</div>
      {!can('crm.activity.read') ? <Empty>Bạn không có quyền xem hoạt động.</Empty> : b.activities.length === 0 ? <Empty>Chưa có hoạt động.</Empty> : (
        <ul className="crm-timeline">{b.activities.map((a) => (
          <li key={a.activityId}>
            <div><Badge tone={a.activityStatus === 'OPEN' ? 'blue' : a.activityStatus === 'DONE' ? 'green' : 'grey'}>{ACTIVITY_TYPE[a.activityType]}</Badge> <b>{a.title}</b>
              <small className="crm-sub">{fmtDateTime(a.occurredAt)} · {accountName(a.createdByAccountId)}{a.assignedToAccountId && ` · phụ trách: ${accountName(a.assignedToAccountId)}`}{a.dueAt && ` · hạn ${fmtDateTime(a.dueAt)}`}</small></div>
            {a.description && <p>{a.description}</p>}
            {a.activityStatus === 'OPEN' && <div className="crm-btnrow">
              {can('crm.activity.complete') && <button type="button" className="crm-btn crm-sm crm-primary" onClick={() => run(() => adapter.completeActivity(a.activityId), 'Đã hoàn thành.')}>Hoàn thành</button>}
              {can('crm.activity.update') && <button type="button" className="crm-btn crm-sm" onClick={() => setForm(a)}>Sửa</button>}
              {can('crm.activity.update') && <button type="button" className="crm-btn crm-sm" onClick={() => run(() => adapter.updateActivity(a.activityId, { activityStatus: 'CANCELLED' }), 'Đã hủy hoạt động.')}>Hủy</button>}
            </div>}
          </li>))}</ul>
      )}
      {form && <ActivityForm customerId={b.customer.customerId} activity={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
    </>
  );
}

function ActivityForm({ customerId, activity, onClose }: { customerId: string; activity?: Activity; onClose: () => void }) {
  const { adapter } = useCrm();
  const { run, busy } = useAction();
  const [f, setF] = useState({ activityType: (activity?.activityType === 'HANDOVER' ? 'NOTE' : activity?.activityType ?? 'CALL') as ActivityInput['activityType'], title: activity?.title ?? '',
    description: activity?.description ?? '', occurredAt: toLocalInput(activity?.occurredAt ?? new Date().toISOString()), dueAt: toLocalInput(activity?.dueAt) });
  const save = () => run(async () => {
    const input = { activityType: f.activityType, title: f.title, description: f.description || null, occurredAt: fromLocalInput(f.occurredAt) ?? undefined, dueAt: fromLocalInput(f.dueAt) };
    if (activity) await adapter.updateActivity(activity.activityId, { title: input.title, description: input.description, dueAt: input.dueAt });
    else await adapter.createActivity(customerId, input);
  }, 'Đã lưu hoạt động.').then((ok) => { if (ok) onClose(); });
  return (
    <Modal title={activity ? 'Sửa hoạt động' : 'Ghi nhận hoạt động'} onClose={onClose} footer={<><button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button>
      <button type="button" className="crm-btn crm-primary" disabled={busy} onClick={save}>Lưu</button></>}>
      <div className="crm-form">
        <div className="crm-row2"><Field label="Loại"><select value={f.activityType} disabled={!!activity} onChange={(e) => setF({ ...f, activityType: e.target.value as ActivityInput['activityType'] })}>
          {(['NOTE', 'CALL', 'MEETING', 'TASK', 'FOLLOW_UP'] as const).map((t) => <option key={t} value={t}>{ACTIVITY_TYPE[t]}</option>)}</select></Field>
          <Field label="Thời điểm"><input type="datetime-local" value={f.occurredAt} disabled={!!activity} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} /></Field></div>
        <Field label="Tiêu đề" required><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field>
        <Field label="Nội dung / kết quả"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Hạn theo dõi"><input type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function DocumentsTab({ b }: { b: CustomerBundle }) {
  const { can, accountName } = useCrm();
  const [form, setForm] = useState<{ mode: 'new' | 'version' | 'meta'; doc?: CrmDocument } | null>(null);
  const current = (d: CrmDocument) => !b.documents.some((n) => n.supersedesDocumentId === d.documentId);
  return (
    <>
      <div className="crm-toolbar"><small className="crm-warn">Lưu file thật: <b>chưa có storage được phê duyệt (BLOCKED)</b>. Mô phỏng chỉ ghi metadata.</small><span className="crm-grow" />
        {can('crm.document.manage') && <button type="button" className="crm-btn crm-primary crm-sm" onClick={() => setForm({ mode: 'new' })}>+ Tài liệu (mô phỏng)</button>}</div>
      {!can('crm.document.read') ? <Empty>Bạn không có quyền xem tài liệu.</Empty> : b.documents.length === 0 ? <Empty>Chưa có tài liệu.</Empty> : (
        <div className="crm-tablewrap"><table className="crm-table"><thead><tr><th>Tài liệu</th><th>Loại</th><th>Ngày ký</th><th>Hiệu lực</th><th>Hết hạn</th><th>Trạng thái</th><th>Phiên bản</th><th /></tr></thead>
          <tbody>{b.documents.map((d) => {
            const e = expiry(d.expiryDate);
            return (
              <tr key={d.documentId} className={current(d) ? '' : 'crm-muted'}>
                <td><b>{d.documentName}</b><small className="crm-sub">{d.fileName} · {fileSize(d.fileSize)} · {accountName(d.uploadedByAccountId)}</small></td>
                <td>{DOCUMENT_TYPE[d.documentType]}</td><td>{fmtDate(d.signedDate)}</td><td>{fmtDate(d.effectiveDate)}</td><td>{fmtDate(d.expiryDate)}</td>
                <td><Badge tone={e.status === 'EXPIRED' ? 'red' : e.status === 'EXPIRING_SOON' ? 'amber' : e.status === 'VALID' ? 'green' : 'grey'}>{e.label}</Badge></td>
                <td>{current(d) ? <Badge tone="green">Hiện hành</Badge> : <Badge tone="grey">Đã thay thế</Badge>}{d.supersedesDocumentId && <small className="crm-sub">thay bản cũ</small>}</td>
                <td className="crm-actions">
                  {can('crm.document.manage') && <button type="button" className="crm-btn crm-sm" onClick={() => setForm({ mode: 'meta', doc: d })}>Sửa thông tin</button>}
                  {can('crm.document.manage') && current(d) && <button type="button" className="crm-btn crm-sm" onClick={() => setForm({ mode: 'version', doc: d })}>Phiên bản mới</button>}
                </td>
              </tr>);
          })}</tbody></table></div>
      )}
      {form && <DocumentForm customerId={b.customer.customerId} mode={form.mode} {...(form.doc ? { doc: form.doc } : {})} onClose={() => setForm(null)} />}
    </>
  );
}

function DocumentForm({ customerId, mode, doc, onClose }: { customerId: string; mode: 'new' | 'version' | 'meta'; doc?: CrmDocument; onClose: () => void }) {
  const { adapter } = useCrm();
  const { run, busy } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ documentName: doc?.documentName ?? '', documentType: doc?.documentType ?? 'LEGAL', note: doc?.note ?? '', signedDate: doc?.signedDate ?? '',
    effectiveDate: doc?.effectiveDate ?? '', expiryDate: doc?.expiryDate ?? '' });
  const meta = { documentName: f.documentName, documentType: f.documentType, note: f.note || null, signedDate: f.signedDate || null, effectiveDate: f.effectiveDate || null, expiryDate: f.expiryDate || null };
  const save = () => run(async () => {
    if (mode === 'meta' && doc) { await adapter.updateDocumentMetadata(doc.documentId, meta); return; }
    if (!file) throw new Error('Chọn file PDF, JPG hoặc PNG.');
    const input: DocumentInput = { ...meta, fileName: file.name, fileType: file.type, fileSize: file.size };
    await adapter.createDocument(customerId, input, mode === 'version' ? doc?.documentId ?? null : null);
  }, mode === 'meta' ? 'Đã cập nhật thông tin tài liệu.' : 'Đã ghi metadata tài liệu (mô phỏng — file chưa được lưu).').then((ok) => { if (ok) onClose(); });
  return (
    <Modal title={mode === 'meta' ? 'Sửa thông tin tài liệu' : mode === 'version' ? 'Tải phiên bản mới (mô phỏng)' : 'Thêm tài liệu (mô phỏng)'} onClose={onClose} footer={<>
      <button type="button" className="crm-btn" onClick={onClose}>Hủy bỏ</button><button type="button" className="crm-btn crm-primary" disabled={busy} onClick={save}>Lưu</button></>}>
      {mode !== 'meta' && <p className="crm-note crm-warn">Chưa có storage được phê duyệt: file <b>không được lưu</b>, chỉ ghi tên, loại và dung lượng. Bản cũ được giữ nguyên.</p>}
      <div className="crm-form">
        {mode !== 'meta' && <Field label="File (PDF, JPG, PNG)" required><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
        <div className="crm-row2"><Field label="Tên tài liệu" required><input value={f.documentName} onChange={(e) => setF({ ...f, documentName: e.target.value })} /></Field>
          <Field label="Loại"><select value={f.documentType} onChange={(e) => setF({ ...f, documentType: e.target.value as CrmDocument['documentType'] })}>
            {Object.entries(DOCUMENT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
        <div className="crm-row3"><Field label="Ngày ký"><input type="date" value={f.signedDate} onChange={(e) => setF({ ...f, signedDate: e.target.value })} /></Field>
          <Field label="Ngày hiệu lực"><input type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></Field>
          <Field label="Ngày hết hạn"><input type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></Field></div>
        <Field label="Ghi chú"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
