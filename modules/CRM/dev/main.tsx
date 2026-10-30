import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../frontend/src/styles/base.css';
import '../../../frontend/src/styles/app-shell.css';
import manifest from '../module.json';
import { screens } from '../frontend/index';

// DEV / ACCEPTANCE HARNESS — not part of the package runtime (modules-sync copies only frontend/, backend/, mic/).
// Renders the 5 CRM screens inside the AppShell block layout (topbar · sidebar · crumb + heading + tabs · panel ·
// footer) with the Host's own app-shell.css, so the module can be built, run and accepted on its own with the Mock Adapter.

type Key = keyof typeof screens;
const SCREENS = manifest.frontend.screens as { screenKey: Key; name: string; description: string; tabs: { label: string; path: string }[] }[];
const byPath = (path: string) => SCREENS.find((s) => s.tabs[0]?.path === path) ?? SCREENS[0]!;

function Harness() {
  const [path, setPath] = useState(() => (SCREENS.some((s) => s.tabs[0]?.path === location.pathname) ? location.pathname : '/crm'));
  useEffect(() => {
    (globalThis as { __TALO_CRM_NAVIGATE__?: (p: string) => void }).__TALO_CRM_NAVIGATE__ = (p) => { history.pushState(null, '', p); setPath(p.split('?')[0] ?? '/crm'); setKey((k) => k + 1); };
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const [key, setKey] = useState(0);
  const screen = byPath(path);
  const Screen = screens[screen.screenKey];
  const go = (p: string) => { history.pushState(null, '', p); setPath(p); setKey((k) => k + 1); };
  return (
    <div className="app-shell">
      <header className="top"><div className="brand-zone"><div className="brand"><b style={{ color: '#fff', padding: '0 12px' }}>TALO-MOS</b></div></div>
        <div className="top-main"><div className="company">CRM Module — bản chạy độc lập (Mock Adapter)</div><div className="grow" /></div></header>
      <div className="layout">
        <aside className="sidebar"><nav className="nav" aria-label="Điều hướng CRM">
          {SCREENS.map((s) => <div className="menu-entry" key={s.screenKey}>
            <button type="button" className={s.screenKey === screen.screenKey ? 'nav-btn nav-fn-top active' : 'nav-btn nav-fn-top'} onClick={() => go(s.tabs[0]?.path ?? '/crm')}>
              <span className="nav-abbr" aria-hidden="true">{s.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span><span className="nav-label">{s.name}</span>
            </button></div>)}
        </nav></aside>
        <main className="workspace">
          <div className="crumb" id="crumb">Kinh doanh › CRM › {screen.name}</div>
          <div className="page-heading"><h1 id="title">{screen.name.toLocaleUpperCase('vi')}</h1><p id="desc">{screen.description}</p>
            <div className="tabs" id="tabs" aria-label="Chức năng"><button type="button" className="tab active" aria-pressed="true">{screen.tabs[0]?.label}</button></div></div>
          <section className="panel"><div className="panel-heading"><h2 id="bodyTitle">{screen.tabs[0]?.label}</h2></div>
            <div className="panel-body" id="body"><Screen key={`${screen.screenKey}-${key}`} tab={0} onSessionLost={() => alert('Phiên đăng nhập hết hạn (mô phỏng).')} /></div></section>
          <div className="footer">Bản chạy độc lập của CRM Module · Dữ liệu mô phỏng trong trình duyệt · Không kết nối máy chủ.</div>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
