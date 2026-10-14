import { useState } from 'react';
import type { RefObject } from 'react';
import { t } from '../../services/auth/messages';

// Password input with its own show/hide toggle (AUTH-B1.2: one toggle per field).

export interface PasswordFieldProps {
  readonly id: string;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly value: string;
  readonly placeholder: string;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly describedBy?: string;
  readonly onChange: (value: string) => void;
}

export function PasswordField({ id, inputRef, value, placeholder, invalid, disabled, describedBy, onChange }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const label = t(visible ? 'FC.HIDE' : 'FC.SHOW');
  return (
    <label className="field">
      <svg className="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="4.2" y="10.2" width="15.6" height="11" rx="2" /><path d="M8 10.2V7a4 4 0 0 1 8 0v3.2" /><circle cx="12" cy="15.2" r="1" fill="currentColor" /><path d="M12 16v2" /></svg>
      <input
        ref={inputRef}
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder={placeholder}
        aria-label={placeholder}
        aria-invalid={invalid ? 'true' : undefined}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="password-toggle"
        data-target={id}
        aria-controls={id}
        aria-pressed={visible}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
      ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.7-6 10-6 10 6 10 6-3.7 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg></button>
    </label>
  );
}
