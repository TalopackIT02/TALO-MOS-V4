import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../frontend/src/styles/base.css';
import '../../../frontend/src/styles/app-shell.css';
import symbolUrl from '../../../frontend/src/assets/images/talopack-symbol.png';
import nameUrl from '../../../frontend/src/assets/images/talopack-name.png';
import manifest from '../module.json';
import { screens } from '../frontend/index';

// DEV / ACCEPTANCE HARNESS — not part of the package runtime (modules-sync copies only frontend/, backend/, mic/).
// Renders the 5 CRM screens inside the AppShell block layout (topbar · sidebar · crumb + heading + tabs · panel ·
// footer) with the Host's own app-shell.css and brand assets, including the Host's mobile pattern (≤ 760px: sidebar as a
// drawer opened from the bottom navigation Menu / Trang chủ / Cá nhân), so the module can be accepted on its own with the
// Mock Adapter. The harness does not replace the Host AppShell; it only mirrors its markup classes.

type Key = keyof typeof screens;
const SCREENS = manifest.frontend.screens as { screenKey: Key; name: string; description: string; tabs: { label: string; path: string }[] }[];
const byPath = (path: string) => SCREENS.find((s) => s.tabs[0]?.path === path) ?? SCREENS[0]!;
const ABBR: Record<string, string> = { 'crm.workspace': 'TQ', 'crm.customers': 'KH', 'crm.calendar': 'LH', 'crm.tasks': 'CV', 'crm.reports': 'BC' };

function Harness() {
  const [path, setPath] = useState(() => (SCREENS.some((s) => s.tabs[0]?.path === location.pathname) ? location.pathname : '/crm'));
  const [key, setKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [compact, setCompact] = useState(false); // desktop sidebar compact (Host: .app-shell.sidebar-compact + .layout.compact)
  useEffect(() => {
    (globalThis as { __TALO_CRM_NAVIGATE__?: (p: string) => void }).__TALO_CRM_NAVIGATE__ = (p) => { history.pushState(null, '', p); setPath(p.split('?')[0] ?? '/crm'); setKey((k) => k + 1); setMenuOpen(false); };
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const screen = byPath(path);
  const Screen = screens[screen.screenKey];
  const go = (p: string) => { history.pushState(null, '', p); setPath(p); setKey((k) => k + 1); setMenuOpen(false); setAccountOpen(false); };
  const shellClass = ['app-shell', compact ? 'sidebar-compact' : '', menuOpen ? 'mobile-open' : '', accountOpen ? 'mobile-account-open' : ''].filter(Boolean).join(' ');
  return (
    <div className={shellClass}>
      <header className="top">
        <div className="brand-zone"><div className="brand">
          <img className="brand-symbol" src={symbolUrl} alt="Biểu tượng Tăng Long Pack" />
          <img className="brand-name" src={nameUrl} alt="TALOPACK" />
        </div></div>
        <div className="top-main"><div className="company">Công ty TNHH Tăng Long Pack</div><div className="grow" />
          <span className="crm-harness-tag">CRM Module · bản chạy độc lập (Mock Adapter)</span></div>
      </header>
      <div className={compact ? 'layout compact' : 'layout'}>
        <aside className="sidebar" id="crmSidebar"><nav className="nav" aria-label="Điều hướng CRM">
          {SCREENS.map((s) => <div className="menu-entry" key={s.screenKey}>
            <button type="button" className={s.screenKey === screen.screenKey ? 'nav-btn nav-fn-top active' : 'nav-btn nav-fn-top'}
              aria-current={s.screenKey === screen.screenKey ? 'page' : undefined} title={s.name} onClick={() => go(s.tabs[0]?.path ?? '/crm')}>
              <span className="nav-abbr" aria-hidden="true">{ABBR[s.screenKey] ?? s.name.slice(0, 2).toUpperCase()}</span><span className="nav-label">{s.name}</span>
            </button></div>)}
        </nav>
          <div className="foot"><button type="button" id="collapse-button" aria-pressed={compact} onClick={() => setCompact((v) => !v)}>
            <span>{compact ? '›' : '‹'}</span> <span className="foot-label">{compact ? 'Mở rộng' : 'Thu gọn'}</span></button></div>
        </aside>
        <div className="mobile-overlay" aria-hidden="true" onClick={() => { setMenuOpen(false); setAccountOpen(false); }} />
        <main className="workspace">
          <div className="crumb" id="crumb">Kinh doanh › CRM › {screen.name}</div>
          <div className="page-heading"><h1 id="title">{screen.name.toLocaleUpperCase('vi')}</h1><p id="desc">{screen.description}</p>
            <div className="tabs" id="tabs" aria-label="Chức năng"><button type="button" className="tab active" aria-pressed="true">{screen.tabs[0]?.label}</button></div></div>
          <section className="panel"><div className="panel-heading"><h2 id="bodyTitle">{screen.tabs[0]?.label}</h2></div>
            <div className="panel-body" id="body"><Screen key={`${screen.screenKey}-${key}`} tab={0} onSessionLost={() => alert('Phiên đăng nhập hết hạn (mô phỏng).')} /></div></section>
          <div className="footer">Bản chạy độc lập của CRM Module · Dữ liệu mô phỏng trong trình duyệt · Không kết nối máy chủ.</div>
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Điều hướng điện thoại">
        <button id="mobileBottomMenu" type="button" className={menuOpen ? 'active' : undefined} aria-label="Menu" title="Menu" aria-expanded={menuOpen} aria-controls="crmSidebar"
          onClick={() => { setAccountOpen(false); setMenuOpen((v) => !v); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>
        <button id="mobileBottomHome" type="button" className={screen.screenKey === 'crm.workspace' && !menuOpen && !accountOpen ? 'active' : undefined} aria-label="Trang chủ" title="Trang chủ" onClick={() => go('/crm')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7" /></svg></button>
        <button id="mobileBottomAccount" type="button" className={accountOpen ? 'active' : undefined} aria-label="Cá nhân" title="Cá nhân" aria-expanded={accountOpen}
          onClick={() => { setMenuOpen(false); setAccountOpen((v) => !v); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg></button>
      </nav>
      <div className={accountOpen ? 'mobile-account-panel open' : 'mobile-account-panel'} aria-hidden={!accountOpen}>
        <strong>Tài khoản mô phỏng</strong>
        <p>Đổi tài khoản thử ở thanh "DEMO — IAM GIẢ LẬP" phía trên nội dung. Bản chạy độc lập không có đăng nhập thật.</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
