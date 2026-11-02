import { Fragment, useState } from 'react';
import { Badge, Empty, Modal } from '../components/ui';
import { useCrm, useQuery } from '../hooks/crm';
import type { Handover, LegalChange } from '../types/domain';
import { HANDOVER_STATUS, LEGAL_STATUS, fmtDateTime } from '../utils/format';
import { HandoverBox, LegalBox } from './CustomerProfile';

// Handover / legal-change items of the current account. Owner rule (Gate 1 remediation I, REV02 SCREEN_MAP):
// assignment, handover and legal approval live in the customer-management context only — the dashboard lists them and
// navigates to the Khách hàng screen, where they are processed (the handover receiver may not have the profile in scope yet).
// Finished handovers (REV01 §E "bảng yêu cầu", REV02 /handovers COMPLETED) are listed here too, read-only.

export type WorkRef = { kind: 'handover' | 'legal'; id: string };
const PENDING: Handover['status'][] = ['PENDING_APPROVAL', 'PENDING_CURRENT_ACK', 'PENDING_RECEIVER_ACK'];

export function useWorkQueue() {
  const { adapter, session, can } = useCrm();
  const me = session?.account.accountId ?? '';
  const { data: handovers } = useQuery(() => adapter.listHandovers(), []);
  const { data: legal } = useQuery(() => adapter.listLegalChanges(), []);
  const { data: customers } = useQuery(() => adapter.visibleCustomers(), []);
  const handoverItems = (handovers ?? []).filter((h) => (h.status === 'PENDING_APPROVAL' && can('crm.handover.approve') && h.initiatedByAccountId !== me)
    || (h.status === 'PENDING_CURRENT_ACK' && h.currentSaleAccountId === me) || (h.status === 'PENDING_RECEIVER_ACK' && h.toSaleAccountId === me));
  const legalItems = (legal ?? []).filter((l) => l.requestedByAccountId !== me && ((l.status === 'PENDING_MANAGEMENT' && can('crm.legal_change.approve_management'))
    || (l.status === 'PENDING_ACCOUNTING' && can('crm.legal_change.approve_accounting'))));
  // listHandovers is already limited to the account's scope (participant or customer in scope).
  const finished = (handovers ?? []).filter((h) => !PENDING.includes(h.status));
  const name = (id: string) => customers?.find((c) => c.customerId === id)?.displayName ?? 'Khách hàng (chưa trong phạm vi của bạn)';
  const visible = (id: string) => (customers ?? []).some((c) => c.customerId === id);
  return { handovers: handovers ?? [], legal: legal ?? [], handoverItems, legalItems, finished, count: handoverItems.length + legalItems.length, name, visible };
}

export function WorkQueueRows({ handoverItems, legalItems, name, onPick }: {
  handoverItems: Handover[]; legalItems: LegalChange[]; name: (id: string) => string; onPick: (w: WorkRef) => void;
}) {
  const { accountName } = useCrm();
  if (handoverItems.length + legalItems.length === 0) return <Empty>Không có yêu cầu nào chờ bạn.</Empty>;
  return <>
    {handoverItems.map((h) => <button type="button" key={h.handoverId} className="crm-row-btn" onClick={() => onPick({ kind: 'handover', id: h.handoverId })}>
      <Badge tone="amber">Bàn giao</Badge><span>{name(h.customerId)} — {HANDOVER_STATUS[h.status]}<small className="crm-sub">{accountName(h.currentSaleAccountId)} → {accountName(h.toSaleAccountId)}</small></span></button>)}
    {legalItems.map((l) => <button type="button" key={l.changeRequestId} className="crm-row-btn" onClick={() => onPick({ kind: 'legal', id: l.changeRequestId })}>
      <Badge tone="violet">Pháp lý</Badge><span>{name(l.customerId)} — {LEGAL_STATUS[l.status]}</span></button>)}
  </>;
}

// Steps and transferred work of a finished handover (actors only — no extra personal data).
function HandoverHistory({ h, customerVisible }: { h: Handover; customerVisible: boolean }) {
  const { adapter, accountName } = useCrm();
  const { data: b } = useQuery(() => (customerVisible ? adapter.customerBundle(h.customerId) : Promise.resolve(null)), [h.customerId, customerVisible]);
  const steps: [string, string][] = [
    ['Yêu cầu', `${accountName(h.initiatedByAccountId)} · ${fmtDateTime(h.requestedAt)} · ${h.mode === 'MANAGER_INITIATED' ? 'Luồng A — Quản lý yêu cầu' : 'Luồng B — Sale đề nghị'}`],
    ...(h.managerApprovedByAccountId ? [['Quản lý duyệt', accountName(h.managerApprovedByAccountId)] as [string, string]] : []),
    ...(h.currentAckByAccountId ? [['Sale hiện tại xác nhận', accountName(h.currentAckByAccountId)] as [string, string]] : []),
    ...(h.currentAckOverrideByAccountId ? [['Xác nhận thay (đề xuất D05)', `${accountName(h.currentAckOverrideByAccountId)} — lý do: ${h.currentAckOverrideReason ?? ''}`] as [string, string]] : []),
    ...(h.receiverAckByAccountId ? [['Sale nhận xác nhận', accountName(h.receiverAckByAccountId)] as [string, string]] : []),
    ...(h.rejectedByAccountId ? [['Từ chối', `${accountName(h.rejectedByAccountId)} — lý do: ${h.rejectionReason ?? ''}`] as [string, string]] : []),
    ...(h.completedAt ? [['Hoàn tất', fmtDateTime(h.completedAt)] as [string, string]] : []),
  ];
  const acts = (b?.activities ?? []).filter((a) => h.transferredActivityIds.includes(a.activityId));
  const tasks = (b?.tasks ?? []).filter((t) => h.transferredTaskIds.includes(t.taskId));
  return (
    <div className="crm-card">
      <h3>Diễn biến bàn giao <Badge tone={h.status === 'COMPLETED' ? 'green' : 'grey'}>{HANDOVER_STATUS[h.status]}</Badge></h3>
      <p><small>{accountName(h.currentSaleAccountId)} → {accountName(h.toSaleAccountId)}</small></p>
      <dl className="crm-dl">{steps.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      {h.status === 'COMPLETED' && <>
        <h4 className="crm-h4">Việc đã chuyển</h4>
        <p className="crm-note">{h.transferredActivityIds.length} hoạt động OPEN (Backend REV01, BR-11) · {h.transferredTaskIds.length} To-do (<b>Target Design</b>).</p>
        {customerVisible ? <ul className="crm-history-list">
          {acts.map((a) => <li key={a.activityId}>Hoạt động: {a.title}</li>)}
          {tasks.map((t) => <li key={t.taskId}>To-do: {t.title} <Badge tone="violet">Target Design</Badge></li>)}
        </ul> : <small className="crm-sub">Khách hàng không còn trong phạm vi của bạn — chỉ hiển thị số lượng.</small>}
      </>}
    </div>
  );
}

// Processing / detail dialog — rendered only inside the Khách hàng screen.
export function WorkItemDialog({ work, onClose, onOpenCustomer }: { work: WorkRef; onClose: () => void; onOpenCustomer: (customerId: string) => void }) {
  const q = useWorkQueue();
  const h = work.kind === 'handover' ? q.handovers.find((x) => x.handoverId === work.id) : undefined;
  const l = work.kind === 'legal' ? q.legal.find((x) => x.changeRequestId === work.id) : undefined;
  const customerId = h?.customerId ?? l?.customerId ?? '';
  return (
    <Modal title={work.kind === 'handover' ? 'Xử lý bàn giao khách hàng' : 'Duyệt thay đổi pháp lý'} onClose={onClose} wide footer={<>
      {customerId && q.visible(customerId) && <button type="button" className="crm-btn" onClick={() => onOpenCustomer(customerId)}>Mở hồ sơ khách hàng</button>}
      <button type="button" className="crm-btn" onClick={onClose}>Đóng</button></>}>
      {!h && !l ? <Empty>Không tìm thấy yêu cầu hoặc yêu cầu nằm ngoài phạm vi của bạn.</Empty> : <p><b>{q.name(customerId)}</b></p>}
      {h && (PENDING.includes(h.status) ? <HandoverBox h={h} /> : <HandoverHistory h={h} customerVisible={q.visible(h.customerId)} />)}
      {h && PENDING.includes(h.status) && <p className="crm-note">Khi Sale nhận xác nhận: chuyển hoạt động OPEN của Sale hiện tại (Backend REV01, BR-11) và To-do chưa hoàn thành gắn khách hàng này (<b>Target Design</b> — chưa thuộc Backend REV01, cần duyệt Delta).</p>}
      {l && (l.status === 'PENDING_MANAGEMENT' || l.status === 'PENDING_ACCOUNTING' ? <LegalBox l={l} />
        : <p>Trạng thái hiện tại: <Badge tone={l.status === 'APPLIED' ? 'green' : 'grey'}>{LEGAL_STATUS[l.status]}</Badge></p>)}
    </Modal>
  );
}

// Queue opened from the Khách hàng toolbar: items waiting for me + finished handovers in my scope.
export function WorkQueueDialog({ onClose, onOpenCustomer, initial }: { onClose: () => void; onOpenCustomer: (customerId: string) => void; initial?: WorkRef | null }) {
  const q = useWorkQueue();
  const { accountName } = useCrm();
  const [work, setWork] = useState<WorkRef | null>(initial ?? null);
  const [tab, setTab] = useState<'pending' | 'finished'>('pending');
  if (work) return <WorkItemDialog work={work} onClose={initial ? onClose : () => setWork(null)} onOpenCustomer={onOpenCustomer} />;
  return (
    <Modal title="Bàn giao và duyệt pháp lý chờ xử lý" onClose={onClose} wide footer={<button type="button" className="crm-btn" onClick={onClose}>Đóng</button>}>
      <div className="crm-seg" role="group" aria-label="Danh sách">
        <button type="button" className={tab === 'pending' ? 'active' : ''} aria-pressed={tab === 'pending'} onClick={() => setTab('pending')}>Chờ tôi xử lý ({q.count})</button>
        <button type="button" className={tab === 'finished' ? 'active' : ''} aria-pressed={tab === 'finished'} onClick={() => setTab('finished')}>Bàn giao đã kết thúc ({q.finished.length})</button>
      </div>
      {tab === 'pending' ? <WorkQueueRows handoverItems={q.handoverItems} legalItems={q.legalItems} name={q.name} onPick={setWork} />
        : q.finished.length === 0 ? <Empty>Chưa có bàn giao nào kết thúc trong phạm vi của bạn.</Empty>
          : q.finished.map((h) => <button type="button" key={h.handoverId} className="crm-row-btn" onClick={() => setWork({ kind: 'handover', id: h.handoverId })}>
            <Badge tone={h.status === 'COMPLETED' ? 'green' : 'grey'}>{HANDOVER_STATUS[h.status]}</Badge>
            <span>{q.name(h.customerId)}<small className="crm-sub">{accountName(h.currentSaleAccountId)} → {accountName(h.toSaleAccountId)} · {fmtDateTime(h.completedAt ?? h.requestedAt)}</small></span></button>)}
    </Modal>
  );
}
