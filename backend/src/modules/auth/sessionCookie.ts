import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

// Session cookie (AD-4): `talo_sid=<token>; HttpOnly; SameSite=Strict; Path=/` (+ Secure in production), no Max-Age /
// Expires — server-side expiry is authoritative. The token (32 random bytes, base64url) exists only in this cookie; the
// database stores SHA-256 hex. The token is never logged.

export const SESSION_COOKIE = 'talo_sid';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Returns the token only when it has the exact shape of a token we issue; anything else is treated as "no session".
export function readSessionToken(req: Request): string | undefined {
  const header = req.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : undefined;
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`);
}
