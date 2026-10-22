// Client for the Foundation API (FBE-01…06). Same rules as authApi: same-origin cookie session (HttpOnly talo_sid, sent
// by the browser), no token / password storage, no automatic retry of a request with side effects. The server is the
// only authority: every 403 / 409 / 422 is shown as returned, never worked around by the UI.

export interface ModuleRecord {
  moduleId: string;
  moduleKey: string;
  moduleName: string;
  description: string | null;
  moduleType: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type VersionStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'ACTIVE' | 'RETIRED' | 'REJECTED';

export interface VersionRecord {
  versionId: string;
  moduleId: string;
  moduleVersion: string;
  contractVersion: string;
  status: string;
  manifestJson: unknown;
  manifestHash: string | null;
  submittedByAccountId: string | null;
  createdAt: string;
  reviewedByAccountId: string | null;
  reviewedAt: string | null;
  activatedAt: string | null;
}

export interface NavigationItem {
  navigationId: string;
  parentId: string | null;
  moduleId: string | null;
  functionId: string | null;
  menuTitle: string;
  sortOrder: number;
  isVisible: boolean;
  createdAt: string;
}

export interface MenuNode {
  navigationId: string;
  moduleId: string | null;
  functionId: string | null;
  menuTitle: string;
  sortOrder: number;
  routePath: string | null;
  screenKey: string | null;
  developArea: boolean; // the DEVELOP area (Navigation Builder); the shell shows the system screens inside it
  children: MenuNode[];
}

// Navigation Builder (GET / PUT /api/foundation/navigation/builder): areas → menus → Function links + legacy rows.
export interface LayoutLink { id: string; functionId: string; moduleId: string; title: string; visible: boolean }
export interface LayoutMenu { id: string; moduleId: string | null; title: string; visible: boolean; items: LayoutLink[] }
export interface LayoutArea { id: string; moduleId: string | null; title: string; visible: boolean; develop: boolean; menus: LayoutMenu[] }
export type LegacyReason = 'FUNCTION_AT_ROOT' | 'FUNCTION_UNDER_AREA' | 'TOO_DEEP' | 'UNREACHABLE';
export interface LegacyItem {
  id: string; kind: 'function' | 'group'; functionId: string | null; moduleId: string | null; title: string; visible: boolean; path: string[]; inDevelop: boolean;
  reason: LegacyReason;
}
export interface NavigationLayout { revision: string; developAreaId: string | null; areas: LayoutArea[]; legacy: LegacyItem[] }
export type InventoryReason = 'MODULE_DISABLED' | 'NO_ACTIVE_VERSION' | 'NO_ROUTE_OR_PERMISSION';
export interface InventoryFunction {
  functionId: string; moduleId: string; moduleKey: string; moduleName: string; functionKey: string; displayName: string;
  assignable: boolean; reason: InventoryReason | null; developer: boolean;
}
// The whole draft sent on preview / save (id null = a new row).
export interface DraftLink { id: string | null; functionId: string; title: string; visible: boolean }
export interface DraftMenu { id: string | null; title: string; visible: boolean; items: DraftLink[] }
export interface DraftArea { id: string | null; title: string; visible: boolean; develop: boolean; menus: DraftMenu[] }
export interface DraftLayout { revision: string; areas: DraftArea[]; legacy: { id: string; visible: boolean }[] }

export interface ApiFailure {
  ok: false;
  status: number; // 0 = no response (network)
  code: string;
  details: string[]; // details.errors (MIC / gate codes) or details.fields (validation)
  requestId: string;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function req(v: Json, key: string): string {
  const value = v[key];
  if (typeof value !== 'string') throw new Error(`field ${key}`);
  return value;
}

function toModule(v: unknown): ModuleRecord {
  if (!isObject(v) || typeof v.isEnabled !== 'boolean') throw new Error('module');
  return {
    moduleId: req(v, 'moduleId'), moduleKey: req(v, 'moduleKey'), moduleName: req(v, 'moduleName'), description: str(v.description),
    moduleType: req(v, 'moduleType'), isEnabled: v.isEnabled, createdAt: req(v, 'createdAt'), updatedAt: req(v, 'updatedAt'),
  };
}

function toVersion(v: unknown): VersionRecord {
  if (!isObject(v)) throw new Error('version');
  return {
    versionId: req(v, 'versionId'), moduleId: req(v, 'moduleId'), moduleVersion: req(v, 'moduleVersion'), contractVersion: req(v, 'contractVersion'),
    status: req(v, 'status'), manifestJson: v.manifestJson ?? null, manifestHash: str(v.manifestHash), submittedByAccountId: str(v.submittedByAccountId),
    createdAt: req(v, 'createdAt'), reviewedByAccountId: str(v.reviewedByAccountId), reviewedAt: str(v.reviewedAt), activatedAt: str(v.activatedAt),
  };
}

function toItem(v: unknown): NavigationItem {
  if (!isObject(v) || typeof v.sortOrder !== 'number' || typeof v.isVisible !== 'boolean') throw new Error('navigation item');
  return {
    navigationId: req(v, 'navigationId'), parentId: str(v.parentId), moduleId: str(v.moduleId), functionId: str(v.functionId), menuTitle: req(v, 'menuTitle'),
    sortOrder: v.sortOrder, isVisible: v.isVisible, createdAt: req(v, 'createdAt'),
  };
}

function toNode(v: unknown): MenuNode {
  if (!isObject(v) || typeof v.sortOrder !== 'number' || !Array.isArray(v.children)) throw new Error('menu node');
  return {
    navigationId: req(v, 'navigationId'), moduleId: str(v.moduleId), functionId: str(v.functionId), menuTitle: req(v, 'menuTitle'), sortOrder: v.sortOrder,
    routePath: str(v.routePath), screenKey: str(v.screenKey), developArea: v.developArea === true, children: v.children.map(toNode),
  };
}

function bool(v: Json, key: string): boolean {
  const value = v[key];
  if (typeof value !== 'boolean') throw new Error(`field ${key}`);
  return value;
}
function arr(v: Json, key: string): unknown[] {
  const value = v[key];
  if (!Array.isArray(value)) throw new Error(`field ${key}`);
  return value;
}
function obj(v: unknown, what: string): Json {
  if (!isObject(v)) throw new Error(what);
  return v;
}
const LEGACY_REASONS: readonly LegacyReason[] = ['FUNCTION_AT_ROOT', 'FUNCTION_UNDER_AREA', 'TOO_DEEP', 'UNREACHABLE'];
const INVENTORY_REASONS: readonly InventoryReason[] = ['MODULE_DISABLED', 'NO_ACTIVE_VERSION', 'NO_ROUTE_OR_PERMISSION'];

function toLink(u: unknown): LayoutLink {
  const v = obj(u, 'link');
  return { id: req(v, 'id'), functionId: req(v, 'functionId'), moduleId: req(v, 'moduleId'), title: req(v, 'title'), visible: bool(v, 'visible') };
}
function toMenu(u: unknown): LayoutMenu {
  const v = obj(u, 'menu');
  return { id: req(v, 'id'), moduleId: str(v.moduleId), title: req(v, 'title'), visible: bool(v, 'visible'), items: arr(v, 'items').map(toLink) };
}
function toArea(u: unknown): LayoutArea {
  const v = obj(u, 'area');
  return { id: req(v, 'id'), moduleId: str(v.moduleId), title: req(v, 'title'), visible: bool(v, 'visible'), develop: bool(v, 'develop'), menus: arr(v, 'menus').map(toMenu) };
}
function toLegacy(u: unknown): LegacyItem {
  const v = obj(u, 'legacy');
  const reason = LEGACY_REASONS.find((r) => r === v.reason);
  if (reason === undefined || (v.kind !== 'function' && v.kind !== 'group')) throw new Error('legacy');
  return { id: req(v, 'id'), kind: v.kind, functionId: str(v.functionId), moduleId: str(v.moduleId), title: req(v, 'title'), visible: bool(v, 'visible'), path: strings(v.path), inDevelop: bool(v, 'inDevelop'), reason };
}
function toLayout(u: unknown): NavigationLayout {
  const v = obj(u, 'layout');
  return { revision: req(v, 'revision'), developAreaId: str(v.developAreaId), areas: arr(v, 'areas').map(toArea), legacy: arr(v, 'legacy').map(toLegacy) };
}
function toInventory(u: unknown): InventoryFunction {
  const v = obj(u, 'function');
  const reason = v.reason === null ? null : INVENTORY_REASONS.find((r) => r === v.reason);
  if (reason === undefined) throw new Error('reason');
  return {
    functionId: req(v, 'functionId'), moduleId: req(v, 'moduleId'), moduleKey: req(v, 'moduleKey'), moduleName: req(v, 'moduleName'), functionKey: req(v, 'functionKey'),
    displayName: req(v, 'displayName'), assignable: bool(v, 'assignable'), reason, developer: bool(v, 'developer'),
  };
}

const field = (key: string) => (payload: unknown): unknown => (isObject(payload) ? payload[key] : undefined);
const listOf = <T>(key: string, map: (v: unknown) => T) => (payload: unknown): T[] => {
  const value = field(key)(payload);
  if (!Array.isArray(value)) throw new Error(key);
  return value.map(map);
};
const one = <T>(key: string, map: (v: unknown) => T) => (payload: unknown): T => map(field(key)(payload));

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

async function call<T>(method: Method, path: string, body: unknown, parse: (payload: unknown) => T): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', details: [], requestId: '' };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.ok) {
    try {
      return { ok: true, data: parse(payload) };
    } catch {
      return { ok: false, status: response.status, code: 'UNEXPECTED_RESPONSE', details: [], requestId: '' };
    }
  }
  const error = isObject(payload) && isObject(payload.error) ? payload.error : {};
  const details = isObject(error.details) ? error.details : {};
  return {
    ok: false, status: response.status, code: str(error.code) ?? 'UNKNOWN', details: [...strings(details.errors), ...strings(details.fields)],
    requestId: str(error.requestId) ?? '',
  };
}

const v = (moduleId: string, versionId: string) => `/foundation/modules/${encodeURIComponent(moduleId)}/versions/${encodeURIComponent(versionId)}`;

export const foundationApi = {
  listModules: () => call('GET', '/foundation/modules', undefined, listOf('modules', toModule)),
  registerModule: (input: { moduleKey: string; moduleName: string; description: string | null; moduleType: string }) =>
    call('POST', '/foundation/modules', input, one('module', toModule)),
  enableModule: (moduleId: string) => call('POST', `/foundation/modules/${encodeURIComponent(moduleId)}/enable`, {}, one('module', toModule)),
  disableModule: (moduleId: string) => call('POST', `/foundation/modules/${encodeURIComponent(moduleId)}/disable`, {}, one('module', toModule)),
  listVersions: (moduleId: string) => call('GET', `/foundation/modules/${encodeURIComponent(moduleId)}/versions`, undefined, listOf('versions', toVersion)),
  getVersion: (moduleId: string, versionId: string) => call('GET', v(moduleId, versionId), undefined, one('version', toVersion)),
  createVersion: (moduleId: string, moduleVersion: string, contractVersion: string) =>
    call('POST', `/foundation/modules/${encodeURIComponent(moduleId)}/versions`, { moduleVersion, contractVersion }, one('version', toVersion)),
  putManifest: (moduleId: string, versionId: string, manifest: Json | null) => call('PUT', `${v(moduleId, versionId)}/manifest`, { manifest }, one('version', toVersion)),
  lifecycle: (moduleId: string, versionId: string, action: 'submit' | 'approve' | 'reject' | 'activate' | 'retire') =>
    call('POST', `${v(moduleId, versionId)}/${action}`, {}, one('version', toVersion)),
  menu: () => call('GET', '/foundation/navigation', undefined, listOf('navigation', toNode)),
  createItem: (input: { parentId: string | null; moduleId: string | null; functionId: string | null; menuTitle: string; sortOrder: number; isVisible: boolean }) =>
    call('POST', '/foundation/navigation/items', input, one('item', toItem)),
  updateItem: (navigationId: string, change: { menuTitle?: string; sortOrder?: number; isVisible?: boolean }) =>
    call('PATCH', `/foundation/navigation/items/${encodeURIComponent(navigationId)}`, change, one('item', toItem)),
  builderLayout: () => call('GET', '/foundation/navigation/builder', undefined, one('layout', toLayout)),
  builderFunctions: () => call('GET', '/foundation/navigation/builder/functions', undefined, listOf('functions', toInventory)),
  builderPreview: (draft: DraftLayout) => call('POST', '/foundation/navigation/builder/preview', draft, listOf('navigation', toNode)),
  builderApply: (draft: DraftLayout) => call('PUT', '/foundation/navigation/builder', draft, one('layout', toLayout)),
};

export const isJsonObject = isObject;
