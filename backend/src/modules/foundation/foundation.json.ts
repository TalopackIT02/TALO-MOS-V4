import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import canonicalize from 'canonicalize';
import express from 'express';
import dupKeyValidator from 'json-dup-key-validator';

// FBE-02B — JSON input rules (P-1, P-13, P-14, P-15).
//   P-1  PUT …/manifest is parsed by its own JSON parser (262144 bytes) mounted in app.ts BEFORE the global 10 kB parser;
//        body-parser skips a request whose body was already read, so the body is parsed exactly once. Over the limit:
//        413 (global error handler). The raw text is kept (per request, in a WeakMap) for the duplicate-key check.
//   P-14 safe integers only; no duplicate object keys (checked on the raw text, before JSON.parse loses them); no lone
//        surrogate in property names or string values. Invalid input is rejected, never repaired.
//   P-13 / P-15 RFC 8785 canonical form (canonicalize@5.1.0) → SHA-256 over its UTF-8 bytes → 64 lowercase hex chars.

export const MANIFEST_ROUTE = '/foundation/modules/:moduleId/versions/:versionId/manifest';
export const MANIFEST_BODY_LIMIT = 262144; // 256 KiB (P-1)

const rawBodies = new WeakMap<IncomingMessage, string>();

export const manifestJsonParser = express.json({
  limit: MANIFEST_BODY_LIMIT,
  verify: (req: IncomingMessage, _res, buf: Buffer) => {
    rawBodies.set(req, buf.toString('utf8'));
  },
});

export function rawJsonBody(req: IncomingMessage): string | undefined {
  return rawBodies.get(req);
}

// True when the raw JSON text has no duplicate key in any object (json-dup-key-validator@1.0.3).
export function hasNoDuplicateKeys(raw: string): boolean {
  return dupKeyValidator.validate(raw, false) === undefined;
}

// Lone UTF-16 surrogates (a high surrogate not followed by a low one, or a low one without a preceding high one).
export function isWellFormedUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export type JsonViolation = 'UNSAFE_NUMBER' | 'INVALID_UNICODE' | 'UNSUPPORTED_VALUE';

// Walks a parsed JSON value (iteratively, no recursion limit) and returns the first P-14 violation, or null.
export function jsonViolation(value: unknown): JsonViolation | null {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isSafeInteger(current)) return 'UNSAFE_NUMBER';
      continue;
    }
    if (typeof current === 'string') {
      if (!isWellFormedUnicode(current)) return 'INVALID_UNICODE';
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (typeof current === 'object') {
      for (const [key, item] of Object.entries(current)) {
        if (!isWellFormedUnicode(key)) return 'INVALID_UNICODE';
        stack.push(item);
      }
      continue;
    }
    return 'UNSUPPORTED_VALUE';
  }
  return null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface CanonicalDigest {
  readonly canonical: string;
  readonly sha256: string;
}

// RFC 8785 canonical JSON and its SHA-256 (lowercase hex). Throws when the value has no canonical form.
export function canonicalDigest(value: unknown): CanonicalDigest {
  const canonical = canonicalize(value);
  if (typeof canonical !== 'string') throw new Error('value has no RFC 8785 representation');
  return { canonical, sha256: createHash('sha256').update(canonical, 'utf8').digest('hex') };
}
