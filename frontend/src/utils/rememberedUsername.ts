// "Ghi nhớ đăng nhập" (R4 + S1): the username only, in localStorage. Never a token, session id or password.
// Storage can be unavailable (private mode, blocked site data): every access is guarded and failures are ignored.

const KEY = 'talo.auth.rememberedUsername';

export function readRememberedUsername(): string | undefined {
  try {
    return window.localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberUsername(username: string): void {
  try {
    window.localStorage.setItem(KEY, username);
  } catch {
    // ignore
  }
}

export function forgetUsername(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
