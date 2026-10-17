import type { ApiResult } from '../../services/foundation/foundationApi';
import { describeFailure } from '../../services/foundation/foundationMessages';
import '../../styles/foundation.css';

// Shared pieces of the Foundation screens (FE-01). A 401 hands control back to App (login); every other failure is
// shown as a message. The UI never decides authorisation: buttons follow the known state, the server has the last word.

export interface Feedback {
  readonly tone: 'error' | 'success' | 'info';
  readonly text: string;
}

export interface ScreenProps {
  readonly tab: number;
  readonly onSessionLost: () => void;
}

// Returns the data, or null after reporting the failure (401 → onSessionLost).
export function settle<T>(result: ApiResult<T>, onSessionLost: () => void, report: (f: Feedback) => void): T | null {
  if (result.ok) return result.data;
  if (result.status === 401) {
    onSessionLost();
    return null;
  }
  report({ tone: 'error', text: describeFailure(result) });
  return null;
}

export function FeedbackLine({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return <div className={`fx-msg ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</div>;
}

const STATUS_TEXT: Record<string, string> = {
  DRAFT: 'Nháp', IN_REVIEW: 'Chờ duyệt', APPROVED: 'Đã duyệt', ACTIVE: 'Đang hoạt động', RETIRED: 'Ngừng sử dụng', REJECTED: 'Bị từ chối',
};

export function StatusTag({ status }: { status: string }) {
  return <span className={`tag fx-status-${status.toLowerCase()}`}>{STATUS_TEXT[status] ?? status}</span>;
}

export function formatTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
}
