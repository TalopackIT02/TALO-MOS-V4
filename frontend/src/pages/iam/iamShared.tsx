import { useCallback, useEffect, useState } from 'react';
import { IAM_TEXT, iamApi } from '../../services/iam/iamApi';
import type { ActiveModule, ModuleFunction } from '../../services/iam/iamApi';
import type { ApiResult } from '../../services/foundation/foundationApi';
import { describeFailure } from '../../services/foundation/foundationMessages';
import type { Feedback } from '../foundation/common';

// Pieces shared by the IAM screens and the Foundation B09 manager (both read names through the IAM adapter).

// API result → data, or null after reporting the failure (401 → onSessionLost; IAM codes in Vietnamese + reference).
export function useSettle(onSessionLost: () => void, setFeedback: (f: Feedback | null) => void) {
  return useCallback(<T,>(result: ApiResult<T>): T | null => {
    if (result.ok) return result.data;
    if (result.status === 401) {
      onSessionLost();
      return null;
    }
    const own = IAM_TEXT[result.code];
    const reference = result.requestId ? ` Mã tham chiếu: ${result.requestId}.` : '';
    setFeedback({ tone: 'error', text: own ? `${own}${reference}` : describeFailure(result) + (result.status < 500 ? reference : '') });
    return null;
  }, [onSessionLost, setFeedback]);
}

export const statusTag = (active: boolean, text: string) => <span className={active ? 'tag fx-status-active' : 'tag'}>{text}</span>;

// Integration-test fixtures (FBET_*) are hidden from choice lists (display filter only; the API is unchanged).
export const isTestModuleKey = (key: string | null | undefined) => (key ?? '').startsWith('FBET_');

export interface FunctionChoice {
  readonly functionId: string;
  readonly functionKey: string;
  readonly displayName: string;
  readonly actions: readonly string[];
}

// Distinct Functions of the adapter rows (one row per Function × Action).
export function byFunction(rows: readonly ModuleFunction[]): FunctionChoice[] {
  const map = new Map<string, { functionId: string; functionKey: string; displayName: string; actions: string[] }>();
  for (const r of rows) {
    const f = map.get(r.functionId) ?? { functionId: r.functionId, functionKey: r.functionKey, displayName: r.displayName, actions: [] };
    if (r.actionKey) f.actions.push(r.actionKey);
    map.set(r.functionId, f);
  }
  return [...map.values()];
}

// Modules with an ACTIVE version and the Functions / Actions of the chosen one (names from B05 / MIC).
export function useModuleFunctions(settle: <T>(r: ApiResult<T>) => T | null) {
  const [modules, setModules] = useState<ActiveModule[]>([]);
  const [moduleId, setModuleId] = useState('');
  const [functions, setFunctions] = useState<ModuleFunction[]>([]);
  useEffect(() => { void iamApi.activeModules().then((r) => setModules((settle(r) ?? []).filter((m) => !isTestModuleKey(m.moduleKey)))); }, [settle]);
  useEffect(() => {
    setFunctions([]);
    if (moduleId) void iamApi.functions(moduleId).then((r) => setFunctions(settle(r) ?? []));
  }, [moduleId, settle]);
  return { modules, moduleId, setModuleId, functions, module: modules.find((m) => m.moduleId === moduleId) ?? null };
}

// "Tên hiển thị (MÃ · phiên bản)" for a module choice.
export const moduleLabel = (m: ActiveModule) => `${m.moduleName || m.moduleKey} (${m.moduleKey} · ${m.activeVersion})${m.isEnabled ? '' : ' — đang tắt'}`;
