import type {
  ActivityType, AppointmentStatus, CustomerStatus, CustomerType, DocumentType, HandoverStatus, IdentifierType, LegalStatus, ReportStatus, TaskPriority, TaskStatus,
} from '../types/domain';

// Vietnamese labels and date helpers (local time zone of the browser).

export const CUSTOMER_TYPE: Record<CustomerType, string> = {
  COMPANY: 'Công ty', BRANCH: 'Chi nhánh', HOUSEHOLD: 'Hộ kinh doanh', PERSON: 'Cá nhân', FOREIGN_NO_VN_REG: 'Nước ngoài (không ĐK tại VN)',
};
export const CUSTOMER_STATUS: Record<CustomerStatus, string> = { PROSPECT: 'Tiềm năng', NEW: 'Khách hàng mới', ACTIVE: 'Đang hợp tác', PAUSED: 'Tạm dừng', CLOSED: 'Ngừng hợp tác' };
export const IDENTIFIER_TYPE: Record<IdentifierType, string> = { VN_TAX_ID: 'Mã số thuế', VN_PERSONAL_ID: 'CCCD', FOREIGN_REG: 'Mã đăng ký nước ngoài' };
export const ACTIVITY_TYPE: Record<ActivityType, string> = { NOTE: 'Ghi chú', CALL: 'Cuộc gọi', MEETING: 'Gặp gỡ', TASK: 'Việc cần làm', FOLLOW_UP: 'Theo dõi', HANDOVER: 'Bàn giao' };
export const DOCUMENT_TYPE: Record<DocumentType, string> = { LEGAL: 'Pháp lý', CONTRACT: 'Hợp đồng', AUTHORIZATION: 'Ủy quyền', OTHER: 'Khác' };
export const HANDOVER_STATUS: Record<HandoverStatus, string> = {
  PENDING_APPROVAL: 'Chờ quản lý duyệt', PENDING_CURRENT_ACK: 'Chờ Sale hiện tại xác nhận', PENDING_RECEIVER_ACK: 'Chờ Sale nhận xác nhận',
  COMPLETED: 'Hoàn tất', REJECTED: 'Bị từ chối', CANCELLED: 'Đã hủy',
};
export const LEGAL_STATUS: Record<LegalStatus, string> = {
  PENDING_MANAGEMENT: 'Chờ quản lý duyệt', PENDING_ACCOUNTING: 'Chờ kế toán duyệt', APPLIED: 'Đã áp dụng', REJECTED: 'Bị từ chối', CANCELLED: 'Đã hủy',
};
export const APPOINTMENT_STATUS: Record<AppointmentStatus, string> = { SCHEDULED: 'Đã lên lịch', DONE: 'Đã diễn ra', CANCELLED: 'Đã hủy' };
export const TASK_STATUS: Record<TaskStatus, string> = { TODO: 'Chưa làm', IN_PROGRESS: 'Đang làm', DONE: 'Hoàn thành', CANCELLED: 'Đã hủy' };
export const TASK_PRIORITY: Record<TaskPriority, string> = { LOW: 'Thấp', MEDIUM: 'Trung bình', HIGH: 'Cao' };
export const REPORT_STATUS: Record<ReportStatus, string> = { DRAFT: 'Bản nháp', SUBMITTED: 'Đã nộp' };

const pad = (n: number) => String(n).padStart(2, '0');
export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
export const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtDateTime = (iso: string | null | undefined): string => (iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '—');
export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfWeek = (d: Date): Date => addDays(startOfDay(d), -((d.getDay() + 6) % 7)); // Monday
export const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
// <input type="datetime-local"> value ↔ ISO
export const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);
export const todayKey = (): string => dayKey(new Date());

export type ExpiryStatus = 'NO_EXPIRY' | 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
export const EXPIRING_SOON_DAYS = 30; // D06 — proposed, pending owner value
export function expiry(expiryDate: string | null): { status: ExpiryStatus; days: number | null; label: string } {
  if (!expiryDate) return { status: 'NO_EXPIRY', days: null, label: 'Không thời hạn' };
  const days = Math.round((new Date(`${expiryDate}T00:00:00`).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
  if (days < 0) return { status: 'EXPIRED', days, label: `Hết hạn ${-days} ngày` };
  if (days <= EXPIRING_SOON_DAYS) return { status: 'EXPIRING_SOON', days, label: `Còn ${days} ngày` };
  return { status: 'VALID', days, label: `Còn ${days} ngày` };
}
export const fileSize = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
