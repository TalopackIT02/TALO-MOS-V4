import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';
import { canonicalDigest, hasNoDuplicateKeys, isWellFormedUnicode, jsonViolation } from '../../../src/modules/foundation/foundation.json.js';
import { MIC_ERROR_CODES, validateMic } from '../../../src/modules/foundation/foundation.mic.js';
import type { MicContext } from '../../../src/modules/foundation/foundation.mic.js';
import { validMic } from './mic.fixture.js';

// FBE-02B — RFC 8785 (canonicalize@5.1.0), SHA-256, JSON input rules (P-14) and MIC-1.0 validation (P-16 / P-17).

const fromHex = (hex: string) => Buffer.from(hex, 'hex').readDoubleBE(0);

// RFC 8785 Appendix B (IEEE-754 bits → canonical text). Each pair is also checked bit-for-bit below, so the table does
// not depend on the library under test.
const NUMBER_VECTORS: [string, string][] = [
  ['0000000000000000', '0'], ['8000000000000000', '0'], ['0000000000000001', '5e-324'], ['8000000000000001', '-5e-324'],
  ['7fefffffffffffff', '1.7976931348623157e+308'], ['ffefffffffffffff', '-1.7976931348623157e+308'],
  ['4340000000000000', '9007199254740992'], ['c340000000000000', '-9007199254740992'], ['4430000000000000', '295147905179352830000'],
  ['44b52d02c7e14af5', '9.999999999999997e+22'], ['44b52d02c7e14af6', '1e+23'], ['44b52d02c7e14af7', '1.0000000000000001e+23'],
  ['444b1ae4d6e2ef4e', '999999999999999700000'], ['444b1ae4d6e2ef4f', '999999999999999900000'], ['444b1ae4d6e2ef50', '1e+21'],
  ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'], ['3eb0c6f7a0b5ed8d', '0.000001'],
  ['41b3de4355555553', '333333333.3333332'], ['41b3de4355555554', '333333333.33333325'], ['41b3de4355555555', '333333333.3333333'],
  ['41b3de4355555556', '333333333.3333334'], ['41b3de4355555557', '333333333.33333343'],
  ['becbf647612f3696', '-0.0000033333333333333333'], ['43143ff3c1cb0959', '1424953923781206.2'],
];

describe('RFC 8785 test vectors (canonicalize@5.1.0)', () => {
  it('number serialisation: 24 IEEE-754 vectors of Appendix B', () => {
    for (const [hex, expected] of NUMBER_VECTORS) {
      expect(fromHex(hex) === Number(expected), `${hex} table consistency`).toBe(true);
      expect(canonicalize(fromHex(hex)), hex).toBe(expected);
    }
    expect(() => canonicalize(fromHex('7fffffffffffffff'))).toThrow(); // NaN
    expect(() => canonicalize(fromHex('7ff0000000000000'))).toThrow(); // Infinity
  });

  it('§3.2.3 sample: numbers, string escaping and literals', () => {
    // JSON text of the RFC sample (JS escapes doubled): "string": "€$\u000F\u000aA'B"\\\\"\/"
    const text = '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], '
      + '"string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/", "literals": [null, true, false]}';
    const expected = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';
    expect(canonicalize(JSON.parse(text))).toBe(expected);
  });

  it('§3.2.3 property sorting by UTF-16 code units', () => {
    const input = {
      '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One',
      '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis',
    };
    expect(canonicalize(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign",'
      + '"😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });
});

describe('SHA-256 manifest digest (P-15)', () => {
  it('SHA-256 over the UTF-8 canonical bytes, 64 lowercase hex characters', () => {
    expect(canonicalDigest({}).sha256).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
    const mic = validMic();
    const { canonical, sha256 } = canonicalDigest(mic);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256).toBe(createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex'));
  });

  it('same data in a different key order → same canonical form and hash; deterministic after parse / serialise', () => {
    const mic = validMic();
    const reordered = JSON.parse(JSON.stringify({
      mic10Manifest: { testEvidence: mic.mic10Manifest.testEvidence, hashAlgorithm: 'SHA-256', manifestVersion: 'MIC-1.0' },
      mic09Compatibility: mic.mic09Compatibility, mic08EventsAudit: mic.mic08EventsAudit, mic07IamMapping: mic.mic07IamMapping,
      mic06DataResources: mic.mic06DataResources, mic05Api: mic.mic05Api, mic04Navigation: mic.mic04Navigation, mic03Actions: mic.mic03Actions,
      mic02Functions: mic.mic02Functions, mic01Identity: { micStandard: 'MIC-1.0', moduleVersion: '1.0.0', moduleName: 'Bán hàng', moduleKey: 'SALES' },
    }));
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(mic));
    expect(canonicalDigest(reordered)).toEqual(canonicalDigest(mic));
    const roundTrip = JSON.parse(canonicalDigest(mic).canonical);
    expect(canonicalDigest(roundTrip)).toEqual(canonicalDigest(mic));
    expect(canonicalDigest(JSON.parse(JSON.stringify(mic, null, 2))).sha256).toBe(canonicalDigest(mic).sha256);
    // Array order is data: changing it changes the hash.
    expect(canonicalDigest({ ...mic, mic02Functions: [...mic.mic02Functions].reverse() }).sha256).not.toBe(canonicalDigest(mic).sha256);
  });
});

describe('JSON input rules (P-14)', () => {
  it('duplicate keys are detected on the raw text, including escaped and nested duplicates; valid escapes pass', () => {
    expect(hasNoDuplicateKeys('{"manifest":{"a":1,"a":2}}')).toBe(false);
    expect(hasNoDuplicateKeys('{"manifest":{"x":[{"k":1,"k":1}]}}')).toBe(false);
    // Escaped spellings of the same key ("a" / "a", "\"" / """) — JS escapes doubled so the JSON text keeps them.
    expect(hasNoDuplicateKeys('{"manifest":{"a":1,"\\u0061":2}}')).toBe(false);
    expect(hasNoDuplicateKeys('{"manifest":{"\\"":1,"\\u0022":2}}')).toBe(false);
    expect(hasNoDuplicateKeys('{"manifest":{"a":1},"manifest":null}')).toBe(false);
    expect(hasNoDuplicateKeys(JSON.stringify({ manifest: { 'a"b': 'x\\"y', '\\': ['"', '\\'], a: { a: 1 } } }))).toBe(true);
  });

  it('only safe integers; lone surrogates rejected in keys and values; nothing is repaired', () => {
    expect(jsonViolation(validMic())).toBeNull();
    expect(jsonViolation({ a: 1.5 })).toBe('UNSAFE_NUMBER');
    expect(jsonViolation({ a: [2 ** 53] })).toBe('UNSAFE_NUMBER');
    expect(jsonViolation({ a: { b: -(2 ** 53) } })).toBe('UNSAFE_NUMBER');
    expect(jsonViolation(JSON.parse('{"a":9007199254740993}'))).toBe('UNSAFE_NUMBER');
    expect(jsonViolation({ a: Number.MAX_SAFE_INTEGER, b: -1, c: 0 })).toBeNull();
    expect(jsonViolation(JSON.parse(String.raw`{"a":"\ud800"}`))).toBe('INVALID_UNICODE');
    expect(jsonViolation(JSON.parse(String.raw`{"\udc00":1}`))).toBe('INVALID_UNICODE');
    expect(jsonViolation(JSON.parse(String.raw`{"x":[{"y":"ok 😀 \udfff"}]}`))).toBe('INVALID_UNICODE');
    expect(isWellFormedUnicode('😀 Tiếng Việt')).toBe(true);
    expect(isWellFormedUnicode('\ud83d')).toBe(false);
    expect(isWellFormedUnicode('\ude00\ud83d')).toBe(false);
  });
});

const ctx = (over: Partial<MicContext> = {}): MicContext => ({
  moduleKey: 'SALES', moduleVersion: '1.0.0', contractVersion: 'MIC-1.0', otherVersions: [], ...over,
});
const errorsOf = (manifest: unknown, c: MicContext = ctx()) => {
  const r = validateMic(manifest, c);
  return r.ok ? [] : [...r.errors];
};

describe('MIC-1.0 schema (P-16)', () => {
  it('a complete valid MIC is accepted; FAIL / NOT_TESTED evidence and parent menus are allowed', () => {
    expect(validateMic(validMic(), ctx()).ok).toBe(true);
    const mic = validMic();
    const ok = { ...mic, mic10Manifest: { ...mic.mic10Manifest, testEvidence: [{ name: 'E2E', result: 'NOT_TESTED', reference: 'n/a' }, { name: 'Load', result: 'FAIL', reference: 'r' }] } };
    expect(validateMic(ok, ctx()).ok).toBe(true);
    expect(validateMic({ ...mic, mic02Functions: [], mic03Actions: [], mic04Navigation: [], mic05Api: [], mic06DataResources: [], mic07IamMapping: [] }, ctx()).ok).toBe(true);
  });

  it('schema violations → MIC_SCHEMA_INVALID only', () => {
    const mic = validMic();
    const bad: unknown[] = [
      null, [], {}, { ...mic, extra: 1 },
      { ...mic, mic10Manifest: { ...mic.mic10Manifest, manifestHash: 'a'.repeat(64) } }, // no self-referencing digest (P-15)
      { ...mic, mic10Manifest: { ...mic.mic10Manifest, testEvidence: [] } },
      { ...mic, mic10Manifest: { ...mic.mic10Manifest, hashAlgorithm: 'SHA-512' } },
      { ...mic, mic01Identity: { ...mic.mic01Identity, moduleKey: 'sales' } },
      { ...mic, mic01Identity: { ...mic.mic01Identity, moduleVersion: '1.0' } },
      { ...mic, mic01Identity: { ...mic.mic01Identity, micStandard: 'MIC-2.0' } },
      { ...mic, mic01Identity: { ...mic.mic01Identity, moduleName: '' } },
      { ...mic, mic02Functions: [{ functionKey: 'F'.repeat(101), name: 'x' }] },
      { ...mic, mic02Functions: [{ functionKey: 'ORDER', name: 'x', description: '' }] },
      { ...mic, mic03Actions: [{ functionKey: 'ORDER', actionKey: 'A'.repeat(31), name: 'x', nature: 'R' }] },
      { ...mic, mic04Navigation: [{ routePath: '/x' }] },
      { ...mic, mic05Api: [{ method: 'TRACE', path: '/x', functionKey: 'ORDER', actionKey: 'READ', errors: [] }] },
      { ...mic, mic05Api: [{ method: 'GET', path: '/x', functionKey: 'ORDER', actionKey: 'READ' }] },
      { ...mic, mic06DataResources: [{ interfaceKind: 'FILE', columns: [], relations: [] }] },
      { ...mic, mic07IamMapping: [{ ...mic.mic07IamMapping[0], minimumAssuranceLevel: 0 }] },
      { ...mic, mic07IamMapping: [{ ...mic.mic07IamMapping[0], minimumAssuranceLevel: 1.5 }] },
      { ...mic, mic08EventsAudit: { eventCodes: [] } },
      { ...mic, mic09Compatibility: { kind: 'MAJOR', changes: [] } },
      { ...mic, mic09Compatibility: { kind: 'CHANGE', fromVersion: 'v1', changes: [] } },
    ];
    for (const manifest of bad) expect(errorsOf(manifest), JSON.stringify(manifest).slice(0, 80)).toEqual(['MIC_SCHEMA_INVALID']);
  });
});

describe('MIC cross-validation (P-17) — the 15 approved error codes', () => {
  it('identity must match B01 module_key and B02 module_version / contract_version', () => {
    // K05 compares moduleCode with mic01.moduleKey, so only the identity check fails here.
    expect(errorsOf(validMic(), ctx({ moduleKey: 'STOCK' }))).toEqual(['IDENTITY_MODULE_KEY_MISMATCH']);
    expect(errorsOf(validMic(), ctx({ moduleVersion: '2.0.0' }))).toEqual(['IDENTITY_MODULE_VERSION_MISMATCH']);
    expect(errorsOf(validMic(), ctx({ contractVersion: 'MIC-0.9' }))).toEqual(['IDENTITY_MIC_STANDARD_MISMATCH']);
  });

  it('functions, actions, navigation and API references', () => {
    const mic = validMic();
    expect(errorsOf({ ...mic, mic02Functions: [...mic.mic02Functions, { functionKey: 'ORDER', name: 'dup' }] })).toEqual(['FUNCTION_KEY_DUPLICATE']);
    const dupAction = { ...mic, mic03Actions: [...mic.mic03Actions, { functionKey: 'ORDER', actionKey: 'READ', name: 'dup', nature: 'READ' }] };
    expect(errorsOf(dupAction)).toEqual(['ACTION_KEY_DUPLICATE']);
    // Same actionKey under another function is a different action (pair uniqueness).
    expect(validateMic(mic, ctx()).ok).toBe(true);
    const unknownFn = {
      ...mic,
      mic03Actions: [...mic.mic03Actions, { functionKey: 'GHOST', actionKey: 'READ', name: 'x', nature: 'READ' }],
      mic07IamMapping: [...mic.mic07IamMapping, { functionKey: 'GHOST', actionKey: 'READ', moduleCode: 'SALES', resourceCode: 'GHOST', operation: 'READ', minimumAssuranceLevel: 1 }],
    };
    expect(errorsOf(unknownFn)).toEqual(['ACTION_FUNCTION_UNKNOWN']);
    expect(errorsOf({ ...mic, mic04Navigation: [{ menuLabel: 'x', functionKey: 'GHOST' }] })).toEqual(['NAVIGATION_FUNCTION_UNKNOWN']);
    expect(errorsOf({ ...mic, mic05Api: [{ method: 'GET', path: '/x', functionKey: 'REPORT', actionKey: 'CREATE', errors: [] }] })).toEqual(['API_ACTION_UNKNOWN']);
  });

  it('IAM mapping: exactly one per action, none extra, K05 identity (moduleCode/resourceCode/operation)', () => {
    const mic = validMic();
    expect(errorsOf({ ...mic, mic07IamMapping: mic.mic07IamMapping.slice(1) })).toEqual(['IAM_MAPPING_MISSING']);
    expect(errorsOf({ ...mic, mic07IamMapping: [...mic.mic07IamMapping, mic.mic07IamMapping[0]] })).toEqual(['IAM_MAPPING_DUPLICATE']);
    const extra = { functionKey: 'REPORT', actionKey: 'EXPORT', moduleCode: 'SALES', resourceCode: 'REPORT', operation: 'EXPORT', minimumAssuranceLevel: 1 };
    expect(errorsOf({ ...mic, mic07IamMapping: [...mic.mic07IamMapping, extra] })).toEqual(['IAM_MAPPING_UNKNOWN_ACTION']);
    for (const field of ['moduleCode', 'resourceCode', 'operation'] as const) {
      const mapping = [{ ...mic.mic07IamMapping[0], [field]: 'OTHER' }, ...mic.mic07IamMapping.slice(1)];
      expect(errorsOf({ ...mic, mic07IamMapping: mapping }), field).toEqual(['IAM_MAPPING_K05_MISMATCH']);
    }
  });

  it('MIC-09 two-way rule against the version history', () => {
    const mic = validMic('SALES', '2.0.0');
    const initial = mic;
    const change = (fromVersion?: string) => ({ ...mic, mic09Compatibility: { kind: 'CHANGE', ...(fromVersion ? { fromVersion } : {}), changes: ['x'] } });
    const noEligible = ctx({ moduleVersion: '2.0.0', otherVersions: [{ moduleVersion: '1.0.0', status: 'REJECTED' }, { moduleVersion: '1.5.0', status: 'DRAFT' }] });
    const eligible = ctx({ moduleVersion: '2.0.0', otherVersions: [{ moduleVersion: '1.0.0', status: 'APPROVED' }] });
    expect(validateMic(initial, noEligible).ok).toBe(true);
    expect(errorsOf({ ...initial, mic09Compatibility: { kind: 'INITIAL_REGISTRATION', fromVersion: '1.0.0', changes: [] } }, noEligible)).toEqual(['COMPATIBILITY_FROM_VERSION_INVALID']);
    expect(errorsOf(change('1.0.0'), noEligible)).toEqual(['COMPATIBILITY_KIND_INVALID']);
    expect(errorsOf(initial, eligible)).toEqual(['COMPATIBILITY_KIND_INVALID']);
    for (const status of ['APPROVED', 'ACTIVE', 'RETIRED']) {
      expect(validateMic(change('1.0.0'), ctx({ moduleVersion: '2.0.0', otherVersions: [{ moduleVersion: '1.0.0', status }] })).ok, status).toBe(true);
    }
    expect(errorsOf(change(), eligible)).toEqual(['COMPATIBILITY_FROM_VERSION_INVALID']);
    expect(errorsOf(change('9.9.9'), eligible)).toEqual(['COMPATIBILITY_FROM_VERSION_INVALID']);
    expect(errorsOf(change('2.0.0'), eligible)).toEqual(['COMPATIBILITY_FROM_VERSION_INVALID']); // itself is not "another" version
  });

  it('several errors are reported together, in the approved order; only the 15 + 7 (FBE-04 Q6) codes exist', () => {
    const mic = validMic();
    const many = { ...mic, mic04Navigation: [{ menuLabel: 'x', functionKey: 'GHOST' }], mic07IamMapping: mic.mic07IamMapping.slice(1) };
    expect(errorsOf(many, ctx({ moduleVersion: '9.0.0' }))).toEqual(['IDENTITY_MODULE_VERSION_MISMATCH', 'NAVIGATION_FUNCTION_UNKNOWN', 'IAM_MAPPING_MISSING']);
    expect(MIC_ERROR_CODES).toHaveLength(22);
  });
});
