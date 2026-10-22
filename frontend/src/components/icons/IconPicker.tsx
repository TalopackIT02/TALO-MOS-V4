import { useMemo, useState } from 'react';
import { DEFAULT_MENU_ICON, NavIcon, useIconNames } from './NavIcon';

// Icon picker of the navigation library: search by icon name, grid of the library SVGs (same NavIcon as the sidebar),
// preview, default icon. The value is an icon KEY only — never a file name or a path typed by hand.

const PAGE = 96;

export interface IconPickerProps {
  readonly value: string | null; // null = default menu icon
  readonly onChange: (key: string | null) => void;
  readonly label?: string;
}

export function IconPicker({ value, onChange, label = 'Icon của menu' }: IconPickerProps) {
  const library = useIconNames();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '-');
    const all = library ? [...library] : [];
    return q === '' ? all : all.filter((n) => n.includes(q));
  }, [library, query]);
  const shown = matches.slice(0, limit);
  const current = value ?? DEFAULT_MENU_ICON;

  return (
    <fieldset className="icon-picker">
      <legend>{label}</legend>
      <div className="icon-picker-head">
        <span className="icon-picker-preview" aria-live="polite">
          <NavIcon name={current} size={28} title={`Icon đã chọn: ${current}`} />
          <span><b>{current}</b>{value === null && <small> (mặc định)</small>}</span>
        </span>
        <input type="search" aria-label="Tìm icon theo tên" placeholder="Tìm icon theo tên (vd: users, chart, box)…" maxLength={64}
          value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} />
        <button type="button" className="fx-btn" disabled={value === null} onClick={() => onChange(null)}>Dùng icon mặc định</button>
      </div>
      {library === null ? <p className="muted">Đang tải thư viện icon…</p> : (
        <>
          <p className="muted icon-picker-count">{matches.length} / {library.size} icon</p>
          <div className="icon-picker-grid" role="listbox" aria-label="Thư viện icon">
            {shown.map((n) => (
              <button type="button" key={n} role="option" aria-selected={n === value} title={n}
                className={n === value ? 'icon-cell selected' : 'icon-cell'} onClick={() => onChange(n)}>
                <NavIcon name={n} size={22} />
                <small>{n}</small>
              </button>
            ))}
          </div>
          {matches.length === 0 && <p className="muted">Không có icon nào khớp “{query}”.</p>}
          {matches.length > shown.length && (
            <button type="button" className="fx-btn" onClick={() => setLimit((l) => l + PAGE * 2)}>Hiển thị thêm ({matches.length - shown.length} icon)</button>
          )}
        </>
      )}
    </fieldset>
  );
}
