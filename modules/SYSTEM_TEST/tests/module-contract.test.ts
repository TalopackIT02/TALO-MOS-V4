import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemTestMic, SYSTEM_TEST_DEFAULT_EVIDENCE } from '../mic/system-test.mic.js';
import { SYSTEM_TEST_BINDING } from '../backend/system-test.permissions.js';
import { SYSTEM_TEST_SQL } from '../backend/system-test.repository.js';
import { SYSTEM_TEST_ACTION } from '../backend/system-test.permissions.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(resolve(root,'module.json'),'utf8')) as {
  moduleKey:string;packageVersion:string;frontend:{screens:{tabs:{path:string}[]}[]};requiredCapabilities:string[];
};
const routes=readFileSync(resolve(root,'backend/system-test.routes.ts'),'utf8');
const screen=readFileSync(resolve(root,'frontend/SystemTestScreen.tsx'),'utf8');

describe('SYSTEM_TEST 1.1 package contracts',()=>{
  it('keeps module identity and removes table viewer everywhere',()=>{
    expect(manifest.moduleKey).toBe('SYSTEM_TEST');
    expect(manifest.packageVersion).toBe('1.1.0');
    expect(manifest.frontend.screens[0]?.tabs.map((t)=>t.path)).toEqual(['/system-test','/system-test/runner']);
    expect(routes).not.toMatch(/\/system-test\/tables/);
    expect(screen).not.toMatch(/DataViewerTab/);
    expect(SYSTEM_TEST_BINDING).not.toHaveProperty('dataViewerRead');
    expect(Object.values(SYSTEM_TEST_ACTION)).not.toContain('SYSTEM_TEST.DATA_VIEWER.READ');
  });
  it('requires exactly the existing Host capabilities, no process execution privilege',()=>{
    expect(manifest.requiredCapabilities).toEqual(['session','authorize','evaluate','lifecycle','readOnly','menuRoutes','inspectManifest','sqlstate','regressionResults','logger']);
    expect(manifest.requiredCapabilities).not.toContain('shell');
  });
  it('defines MIC CHANGE, two functions and exactly three APIs; evidence stays NOT_TESTED',()=>{
    const mic=systemTestMic();
    expect(mic.mic09Compatibility.kind).toBe('CHANGE');
    expect(mic.mic09Compatibility.fromVersion).toBe('1.0.0');
    expect(mic.mic01Identity.moduleVersion).toBe('1.1.0');
    expect(mic.mic02Functions.map(f=>f.functionKey)).toEqual(['DIAGNOSTICS','TEST_RUNNER']);
    expect(mic.mic03Actions.map(a=>a.actionKey)).toEqual(['READ','EXECUTE']);
    expect(mic.mic05Api).toHaveLength(3);
    expect(mic.mic07IamMapping).toHaveLength(2);
    expect(SYSTEM_TEST_DEFAULT_EVIDENCE[0]?.result).toBe('NOT_TESTED');
    expect(JSON.stringify(mic)).not.toMatch(/\/system-test\/data|\/api\/system-test\/tables|\"DATA_VIEWER\"/);
  });
  it('SQL is fixed SELECT only, no table paging/DDL/G R A N T',()=>{
    for(const sql of Object.values(SYSTEM_TEST_SQL)) {
      expect(sql.trim().toUpperCase()).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/i);
      expect(sql).not.toMatch(/iam_credentials|iam_sessions/);
    }
  });
});
