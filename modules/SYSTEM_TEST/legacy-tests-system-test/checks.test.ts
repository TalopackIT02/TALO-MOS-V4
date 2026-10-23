import { describe, expect, it } from 'vitest';
import { CHECK_COMPONENTS, evaluateChecks, summarize } from '../backend/system-test.checks.js';
import type { CheckFacts } from '../backend/system-test.checks.js';
import type { OperationsSnapshot } from '../backend/system-test.repository.js';

const baseOps: OperationsSnapshot = {
  fleet: { state:'AVAILABLE', value:[
    {moduleKey:'SYSTEM_TEST',enabled:true,versionCount:2,activeVersions:1},
    {moduleKey:'DATA_INSPECTOR',enabled:true,versionCount:1,activeVersions:1},
  ] },
  activity: {state:'AVAILABLE',value:{connections:15,maxConnections:100,deadlocks:0,commits:997,rollbacks:3,statsReset:null}},
  audit: {state:'AVAILABLE',value:{denied:0,failures:0}},
};
const facts = (overrides: Partial<CheckFacts>={}): CheckFacts => ({
  moduleKey:'SYSTEM_TEST',assuranceLevel:1,
  snapshot:{
    identity:{databaseName:'talo_mos_v4_test',roleName:'talo_app',serverVersion:'18.6'},
    module:{moduleId:'a',isEnabled:true,activeVersions:1},
    activeVersions:[{versionId:'b',moduleVersion:'1.1.1',manifestHash:'x',manifestJson:{
      mic01Identity:{moduleKey:'SYSTEM_TEST',moduleVersion:'1.1.1'},
      mic02Functions:[{functionKey:'DIAGNOSTICS'},{functionKey:'TEST_RUNNER'}],
      mic03Actions:[{functionKey:'DIAGNOSTICS',actionKey:'READ'},{functionKey:'TEST_RUNNER',actionKey:'EXECUTE'}],
      mic04Navigation:[{functionKey:'DIAGNOSTICS',routePath:'/system-test'},{functionKey:'TEST_RUNNER',routePath:'/system-test/runner'}],
      mic06DataResources:[{resourceKey:'SYSTEM_STATUS',interfaceKind:'API',columns:[1]},{resourceKey:'TEST_RESULTS',interfaceKind:'API',columns:[1]}],
    }}],
    functions:['DIAGNOSTICS','TEST_RUNNER'],actions:['DIAGNOSTICS.READ','TEST_RUNNER.EXECUTE'],
    contracts:[{resourceKey:'SYSTEM_STATUS',interfaceKind:'API',fields:1},{resourceKey:'TEST_RESULTS',interfaceKind:'API',fields:1}],
    compatibility:{checkResult:'PASS',blocking:0},
  },
  iam:[
    {functionKey:'DIAGNOSTICS',permissionCode:'system_test.diagnostics.read',decision:{allowed:true}},
    {functionKey:'TEST_RUNNER',permissionCode:'system_test.test_runner.execute',decision:{allowed:true}},
  ],menuRoutes:['/system-test','/system-test/runner'],manifest:{intact:true,micValid:true},operations:baseOps,
  regression:{state:'NOT_RUN'},...overrides,
});
const status=(items:ReturnType<typeof evaluateChecks>,key:string)=>items.find((x)=>x.key===key)?.status;

describe('SYSTEM_TEST 1.1 diagnostic evaluation',()=>{
  it('exposes 22 distinct check keys and none for the retired data viewer',()=>{
    expect(CHECK_COMPONENTS).toHaveLength(22);
    expect(new Set(CHECK_COMPONENTS.map((x)=>x[0])).size).toBe(22);
    expect(CHECK_COMPONENTS.map((x)=>x[0])).not.toContain('DATA_VIEWER');
  });
  it('marks a healthy observed fleet and DB normally; unrun regression yellow',()=>{
    const rows=evaluateChecks(facts());
    for(const key of ['AUTHENTICATION','POSTGRESQL','REGISTRY','VERSION_MIC','FUNCTION_ACTION','DATA_CONTRACTS',
      'COMPATIBILITY','LIFECYCLE','NAVIGATION','FLEET_DISCOVERY','FLEET_LIFECYCLE','FLEET_RELEASES','DB_CONNECTIONS','DB_DEADLOCKS','DB_ROLLBACKS',
      'AUDIT_DENIED','AUDIT_FAILURE']) expect(status(rows,key),key).toBe('PASS');
    expect(status(rows,'REGRESSION')).toBe('NOT_TESTED');
    expect(status(rows,'DEPLOYMENT_SYNC')).toBe('NOT_TESTED');
    expect(summarize(rows).PASS).toBeGreaterThan(0);
  });
  it('signals missing active versions as critical only for enabled modules',()=>{
    const rows=evaluateChecks(facts({operations:{...baseOps,fleet:{state:'AVAILABLE',value:[{moduleKey:'BROKEN',enabled:true,activeVersions:0,versionCount:1}]}}}));
    expect(status(rows,'FLEET_LIFECYCLE')).toBe('FAIL');
    expect(status(rows,'FLEET_RELEASES')).toBe('PASS');
  });
  it('warns about intentionally disabled modules, not FAIL',()=>{
    const rows=evaluateChecks(facts({operations:{...baseOps,fleet:{state:'AVAILABLE',value:[{moduleKey:'DISABLED',enabled:false,activeVersions:0,versionCount:1}]}}}));
    expect(status(rows,'FLEET_LIFECYCLE')).toBe('WARN');
  });
  it('preserves partial results when B08 is not SELECT-able',()=>{
    const rows=evaluateChecks(facts({operations:{...baseOps,audit:{state:'UNAVAILABLE',sqlstate:'42501'}}}));
    expect(status(rows,'AUDIT_DENIED')).toBe('UNAVAILABLE');
    expect(status(rows,'AUDIT_FAILURE')).toBe('UNAVAILABLE');
    expect(status(rows,'DB_CONNECTIONS')).toBe('PASS');
  });
  it('classifies connection saturation and deadlocks with explicit thresholds',()=>{
    const mk=(connections:number)=>evaluateChecks(facts({operations:{...baseOps,activity:{state:'AVAILABLE',value:{connections,maxConnections:100,deadlocks:2,commits:980,rollbacks:20,statsReset:null}}}}));
    expect(status(mk(80),'DB_CONNECTIONS')).toBe('WARN');
    expect(status(mk(95),'DB_CONNECTIONS')).toBe('FAIL');
    expect(status(mk(30),'DB_DEADLOCKS')).toBe('WARN');
    expect(status(mk(30),'DB_ROLLBACKS')).toBe('PASS');
  });

  it('checks cumulative rollback ratio rather than blindly marking all rollbacks healthy',()=>{
    const rows=evaluateChecks(facts({operations:{...baseOps,activity:{state:'AVAILABLE',value:{
      connections:10,maxConnections:100,deadlocks:0,commits:60,rollbacks:40,statsReset:null}}}}));
    expect(status(rows,'DB_ROLLBACKS')).toBe('FAIL');
  });
  it('marks observed audit DENIED as warning, not a critical fault',()=>{
    const rows=evaluateChecks(facts({operations:{...baseOps,audit:{state:'AVAILABLE',value:{denied:4,failures:3}}}}));
    expect(status(rows,'AUDIT_DENIED')).toBe('WARN');
    expect(status(rows,'AUDIT_FAILURE')).toBe('WARN');
  });
  it('classifies regression failure red, not-run and stale yellow',()=>{
    const reg={state:'AVAILABLE' as const,run:{format:'TALO-SYSTEM-TEST-REGRESSION-1' as const,runId:'run-1',
      startedAt:new Date(Date.now()-5000).toISOString(),finishedAt:new Date().toISOString(),
      target:{database:'test',host:'localhost',nodeEnv:'test'},status:'FAIL' as const,
      suites:[{key:'UNIT',label:'unit',command:'npm test',status:'FAIL' as const,exitCode:1,durationMs:1,
        tests:{passed:1,failed:1,skipped:0},summary:[]}]}};
    expect(status(evaluateChecks(facts({regression:reg})),'REGRESSION')).toBe('FAIL');
    expect(status(evaluateChecks(facts({regression:null})),'REGRESSION')).toBe('NOT_TESTED');
  });
  it('does not falsely green unknown/failed PostgreSQL',()=>{
    const rows=evaluateChecks(facts({snapshot:{error:{code:'42501'}},manifest:null}),e=>(e as {code?:string}).code);
    expect(status(rows,'POSTGRESQL')).toBe('UNAVAILABLE');
    expect(status(rows,'VERSION_MIC')).toBe('UNAVAILABLE');
  });
});
