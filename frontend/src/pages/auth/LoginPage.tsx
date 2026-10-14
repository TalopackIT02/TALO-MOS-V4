import { useState } from 'react';
import type { FormEvent } from 'react';
import logoUrl from '../../assets/images/talopack-logo.png';
import warehouseUrl from '../../assets/images/warehouse-illustration.png';
import '../../styles/auth-login.css';

// AUTH-LOGIN-001 — React port of the approved TALO-MOS-Login-Demo-Responsive-v2.html.
// Phase A keeps the demo's simulated behaviour; no authentication is wired yet.

type MessageTone = 'error' | 'success';
type FormMessage = { text: string; tone: MessageTone };

const MESSAGE_COLOR: Record<MessageTone, string> = { error: '#ad3939', success: '#0b8e4a' };

const DEMO_MESSAGES = {
  forgot: 'Chức năng quên mật khẩu chưa được tích hợp trong bản demo.',
  missingFields: 'Vui lòng nhập tên đăng nhập và mật khẩu.',
  submitted: 'Đây là bản demo giao diện, chưa kết nối hệ thống đăng nhập.',
};

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState<FormMessage | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const complete = username.trim() !== '' && password.length > 0;
    setMessage(
      complete
        ? { text: DEMO_MESSAGES.submitted, tone: 'success' }
        : { text: DEMO_MESSAGES.missingFields, tone: 'error' },
    );
  }

  return (
    <div className="auth-login-page">
      <main className="login-shell">
        <section className="login-panel" aria-labelledby="login-title">
          <img className="logo" src={logoUrl} alt="TALOPACK" />
          <h1 id="login-title">ĐĂNG NHẬP HỆ THỐNG</h1>
          <p className="subtitle">Quản lý sản xuất - Kho vận - Kinh doanh - Toàn diện</p>
          <form className="login-form" id="login-form" noValidate onSubmit={handleSubmit}>
            <label className="field">
              <svg className="field-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7.2" r="4.1" /><path d="M3.2 21v-2.2c0-4 3.8-6.6 8.8-6.6s8.8 2.6 8.8 6.6V21Z" /></svg>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                aria-label="Tên đăng nhập"
                placeholder="Tên đăng nhập"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="field">
              <svg className="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="4.2" y="10.2" width="15.6" height="11" rx="2" /><path d="M8 10.2V7a4 4 0 0 1 8 0v3.2" /><circle cx="12" cy="15.2" r="1" fill="currentColor" /><path d="M12 16v2" /></svg>
              <input
                id="password"
                name="password"
                type={passwordVisible ? 'text' : 'password'}
                autoComplete="current-password"
                aria-label="Mật khẩu"
                placeholder="Mật khẩu"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="password-toggle"
                id="password-toggle"
                aria-label={passwordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                aria-pressed={passwordVisible}
                title="Hiện hoặc ẩn mật khẩu"
                onClick={() => setPasswordVisible((visible) => !visible)}
              ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.7-6 10-6 10 6 10 6-3.7 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg></button>
            </label>
            <div className="options">
              <label className="remember"><input type="checkbox" defaultChecked /> Ghi nhớ đăng nhập</label>
              <button
                className="forgot"
                type="button"
                id="forgot-button"
                onClick={() => setMessage({ text: DEMO_MESSAGES.forgot, tone: 'error' })}
              >Quên mật khẩu?</button>
            </div>
            <button className="login-button" type="submit">ĐĂNG NHẬP <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16M13 5l7 7-7 7" /></svg></button>
            <p
              className="message"
              id="message"
              role="status"
              aria-live="polite"
              style={message ? { color: MESSAGE_COLOR[message.tone] } : undefined}
            >{message ? message.text : null}</p>
          </form>
          <footer className="footer">© 2026 TALOPACK</footer>
        </section>
        <aside className="illustration" aria-label="Minh họa nhà kho TALOPACK"><img src={warehouseUrl} alt="Nhà kho và hoạt động vận chuyển TALOPACK" /></aside>
      </main>
    </div>
  );
}
