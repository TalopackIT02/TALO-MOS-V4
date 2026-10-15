import { useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import logoUrl from '../../assets/images/talopack-logo.png';
import warehouseUrl from '../../assets/images/warehouse-illustration.png';
import { authApi } from '../../services/auth/authApi';
import { messageForFailure } from '../../services/auth/errorMessages';
import type { UiMessage } from '../../services/auth/errorMessages';
import { t } from '../../services/auth/messages';
import type { MessageId } from '../../services/auth/messages';
import { PasswordField } from './PasswordField';
import '../../styles/auth-first-change.css';

// AUTH-B1.2 First Change — React port of design/auth-b1/first-change-demo.html (accepted). Production code only:
// no demo switcher, no simulated server, no direct DOM manipulation (RM-4). State, focus, scrolling, the countdown timer
// and its cleanup follow the React lifecycle (RM-5). The API receives only newPassword (D-UI-1); the confirmation is
// compared here, after NFC. No password is kept once the flow ends.

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;
const codePoints = (value: string) => [...value.normalize('NFC')].length;
const utf8Bytes = (value: string) => new TextEncoder().encode(value.normalize('NFC')).length;
const WARNING_MS = 2 * 60 * 1000;

type Field = 'new' | 'confirm';
type EndState = { readonly text: string; readonly tone: 'success' | 'error' | 'info' };
type HintState = 'idle' | 'ok' | 'fail';

function clientCheck(pw: string, confirm: string): { id: MessageId; field: Field } | null {
  if (!pw) return { id: 'FC.EMPTY_NEW', field: 'new' };
  if (CONTROL.test(pw)) return { id: 'POLICY.CONTROL_CHARACTERS', field: 'new' };
  if (codePoints(pw) < 8) return { id: 'POLICY.TOO_SHORT', field: 'new' };
  if (codePoints(pw) > 128) return { id: 'POLICY.TOO_LONG', field: 'new' };
  if (utf8Bytes(pw) > 512) return { id: 'POLICY.TOO_LONG_BYTES', field: 'new' };
  if (!confirm) return { id: 'FC.EMPTY_CONFIRM', field: 'confirm' };
  if (pw.normalize('NFC') !== confirm.normalize('NFC')) return { id: 'FC.MISMATCH', field: 'confirm' };
  return null;
}

function lengthState(pw: string, submitted: boolean): HintState {
  const n = codePoints(pw);
  if (n >= 8 && n <= 128) return 'ok';
  return n > 128 || (submitted && n > 0) ? 'fail' : 'idle';
}

// D-UI-2: remaining time measured once from expiresAt − serverTime, then counted down on the monotonic clock.
function useActivationCountdown(remainingMs: number, active: boolean): number {
  const deadline = useRef(performance.now() + remainingMs);
  const [left, setLeft] = useState(remainingMs);
  useEffect(() => {
    if (!active) return undefined;
    const update = () => setLeft(Math.max(0, deadline.current - performance.now()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return left;
}

export interface FirstChangePageProps {
  readonly username: string;
  readonly remainingMs: number;
  readonly onBackToLogin: (flash?: UiMessage) => void;
}

export function FirstChangePage({ username, remainingMs, onBackToLogin }: FirstChangePageProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [invalid, setInvalid] = useState<Field | null>(null);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [end, setEnd] = useState<EndState | null>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const focusTarget = useRef<Field | null>(null);

  const left = useActivationCountdown(remainingMs, end === null);
  const expired = end === null && left <= 0;

  const finish = (state: EndState) => {
    setNewPassword('');
    setConfirmPassword('');
    setEnd(state);
  };

  useEffect(() => {
    if (expired) finish({ text: t('SESSION.ACTIVATION_EXPIRED'), tone: 'error' });
  }, [expired]);

  // After a new message: focus the faulty field without scrolling, then bring the status area into view (decision 5).
  useEffect(() => {
    const field = focusTarget.current;
    focusTarget.current = null;
    const ref: RefObject<HTMLInputElement | null> | null = field === 'new' ? newRef : field === 'confirm' ? confirmRef : null;
    ref?.current?.focus({ preventScroll: true });
    if (message) messageRef.current?.scrollIntoView({ block: 'nearest' });
  }, [message]);

  const showError = (next: UiMessage, field: Field | null) => {
    setInvalid(field);
    focusTarget.current = field;
    setMessage(next);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || loggingOut) return;
    setSubmitted(true);
    setInvalid(null);
    setMessage(null);
    const problem = clientCheck(newPassword, confirmPassword);
    if (problem) {
      showError({ text: t(problem.id), tone: 'error' }, problem.field);
      return;
    }
    setSubmitting(true);
    const result = await authApi.firstChange(newPassword);
    setSubmitting(false);
    if (result.ok) {
      finish({ text: t('FC.SUCCESS'), tone: 'success' });
      return;
    }
    const code = result.error?.code;
    if (code === 'SESSION_INVALID') return finish({ text: t('SESSION.ACTIVATION_EXPIRED'), tone: 'error' });
    if (code === 'NOT_REQUIRED') return finish({ text: t('FC.NOT_REQUIRED'), tone: 'info' });
    showError(messageForFailure('firstChange', result), code === 'PASSWORD_POLICY' ? 'new' : null);
  }

  async function handleLogout() {
    if (submitting || loggingOut) return;
    setLoggingOut(true);
    const result = await authApi.logout();
    setLoggingOut(false);
    finish(result.ok ? { text: t('LOGOUT.DONE'), tone: 'info' } : { text: t('LOGOUT.FAILED'), tone: 'error' });
  }

  const busy = submitting || loggingOut;
  const hint = lengthState(newPassword, submitted);
  const minutes = Math.floor(left / 60_000);
  const [accountPrefix, accountSuffix = ''] = t('FC.ACCOUNT', { username: '\u0000' }).split('\u0000');

  return (
    <div className="auth-first-change-page">
      <main className="login-shell">
        <section className="login-panel" aria-labelledby="fc-title">
          <img className="logo" src={logoUrl} alt="TALOPACK" />
          <h1 id="fc-title">{t('FC.TITLE')}</h1>
          <p className="subtitle">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7.2" r="4.1" /><path d="M3.2 21v-2.2c0-4 3.8-6.6 8.8-6.6s8.8 2.6 8.8 6.6V21Z" /></svg>
            <span id="account-line">{accountPrefix}<strong>{username}</strong>{accountSuffix}</span>
          </p>

          {end === null ? (
            <form className="login-form" id="fc-form" noValidate onSubmit={handleSubmit}>
              <PasswordField
                id="new-password"
                inputRef={newRef}
                value={newPassword}
                placeholder={t('FC.NEW_PLACEHOLDER')}
                invalid={invalid === 'new'}
                disabled={busy}
                describedBy="policy-list"
                onChange={(value) => { setNewPassword(value); setInvalid(null); }}
              />
              <PasswordField
                id="confirm-password"
                inputRef={confirmRef}
                value={confirmPassword}
                placeholder={t('FC.CONFIRM_PLACEHOLDER')}
                invalid={invalid === 'confirm'}
                disabled={busy}
                onChange={(value) => { setConfirmPassword(value); setInvalid(null); }}
              />

              <div className="policy-block">
                <p className="policy-title">{t('FC.HINT_TITLE')}</p>
                <ul className="policy" id="policy-list">
                  <li id="hint-length" className="check" data-state={hint}>
                    <span>{t('FC.HINT_LENGTH')}</span>
                    <span className="visually-hidden">{hint === 'ok' ? ` ${t('FC.HINT_STATE_OK')}` : hint === 'fail' ? ` ${t('FC.HINT_STATE_FAIL')}` : ''}</span>
                  </li>
                  <li>{t('FC.HINT_FREE')}</li>
                  <li>{t('FC.HINT_AVOID')}</li>
                  <li>{t('FC.HINT_DIFFERENT')}</li>
                </ul>
              </div>

              <p className={`countdown${left <= WARNING_MS ? ' warning' : ''}`} id="countdown" role="timer" aria-live="off">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                <span id="countdown-text">{minutes >= 1 ? t('SESSION.ACTIVATION_REMAINING', { n: minutes }) : t('SESSION.ACTIVATION_REMAINING_LT1')}</span>
              </p>

              <button className="login-button" type="submit" id="submit-button" disabled={busy}>
                {submitting ? <><span className="spinner" aria-hidden="true" />{t('FC.SUBMITTING')}</> : t('FC.SUBMIT')}
              </button>
              <p ref={messageRef} className={`message${message && message.tone !== 'error' ? ` ${message.tone}` : ''}`} id="message" role="status" aria-live="polite">
                {message?.text}
                {message?.reference ? <span className="ref">{message.reference}</span> : null}
              </p>
            </form>
          ) : (
            <div className="after" id="after">
              <p className={`message${end.tone !== 'error' ? ` ${end.tone}` : ''}`} id="after-message" role="status" aria-live="polite">{end.text}</p>
              <button className="login-button" type="button" id="back-to-login" onClick={() => onBackToLogin()}>{t('FC.BACK_TO_LOGIN')}</button>
            </div>
          )}

          {end === null ? (
            <div className="secondary-actions" id="logout-row">
              <button className="forgot" type="button" id="logout-button" disabled={busy} onClick={() => void handleLogout()}>
                {loggingOut ? t('LOGOUT.LOADING') : t('FC.LOGOUT')}
              </button>
            </div>
          ) : null}
          <footer className="footer">© 2026 TALOPACK</footer>
        </section>
        <aside className="illustration" aria-label="Minh họa nhà kho TALOPACK"><img src={warehouseUrl} alt="Nhà kho và hoạt động vận chuyển TALOPACK" /></aside>
      </main>
    </div>
  );
}
