import { describe, expect, it } from 'vitest';
import { systemTestMic } from '../mic/system-test.mic.js';
import { diagnosticsReportTxt, resultsReportTxt } from '../frontend/reportTxt.js';
import type { QuickCheckRun, ResultsView } from '../frontend/systemTestApi.js';
import { AUDIT_PERMISSION } from '../backend/system-audit.service.js';

describe('SYSTEM_TEST 1.2.0 unification', () => {
  it('declares all five functions/actions and no legacy DATA_VIEWER route', () => {
    const mic=systemTestMic();
    const functions=mic.mic02Functions.map(x=>x.functionKey);
    expect(functions).toEqual(['DIAGNOSTICS','TEST_RUNNER','CATALOG','ROWS','AUDIT_LOG']);
    for(const action of mic.mic03Actions){
      expect(mic.mic07IamMapping.filter(x=>x.functionKey===action.functionKey && x.actionKey===action.actionKey)).toHaveLength(1);
    }
    expect(mic.mic04Navigation.map(x=>x.routePath).filter(Boolean)).toEqual([
      '/system-test','/system-test/runner','/system-test/data','/system-test/logs']);
    expect(mic.mic05Api.map(x=>x.path)).toContain('/api/system-test/audit/logs');
    expect(mic.mic05Api.some(x=>x.path.includes('/api/data-inspector/'))).toBe(false);
    expect(mic.mic10Manifest.testEvidence[0]?.result).toBe('NOT_TESTED');
  });
  it('uses the same IAM K05 as the log function',()=>{
    expect(AUDIT_PERMISSION).toEqual({permissionCode:'system_test.audit.read',moduleCode:'SYSTEM_TEST',resourceCode:'AUDIT_LOG',operation:'READ'});
  });
  const run:QuickCheckRun={runId:'RUN1',moduleKey:'SYSTEM_TEST',startedAt:'2026-10-23T00:00:00Z',finishedAt:'2026-10-23T00:00:02Z',durationMs:2000,
    results:[{key:'POSTGRESQL',label:'PostgreSQL',status:'FAIL',detail:'Lỗi kết nối SQLSTATE 08006'},
      {key:'IAM',label:'IAM',status:'PASS',detail:'Đánh giá ALLOW'}],
    summary:{PASS:1,FAIL:1,WARN:0,NOT_TESTED:0,UNAVAILABLE:0},
    fleet:[{moduleKey:'SYSTEM_TEST',enabled:true,versionCount:3,activeVersions:1}],fleetComplete:true};
  it('exports each individual scan item, fleet and metadata into UTF-8 TXT',()=>{
    const txt=diagnosticsReportTxt(run);
    expect(txt).toContain('RUN1');expect(txt).toContain('FAIL');expect(txt).toContain('SQLSTATE 08006');
    expect(txt).toContain('SYSTEM_TEST | enabled=true');
  });
  it('never pretends a missing regression is PASS',()=>{
    const v:ResultsView={quickCheck:run,regression:{state:'NOT_RUN'},runner:{apiExecution:false,mode:'CLI'}};
    const txt=resultsReportTxt(v);
    expect(txt).toContain('FULL REGRESSION: NOT_RUN');
    expect(txt).toContain('PostgreSQL');
  });
  it('includes each regression suite and its failure summary',()=>{
    const v:ResultsView={quickCheck:run,regression:{state:'AVAILABLE',run:{runId:'REG2',startedAt:'2026-10-23T00:00:00Z',finishedAt:'2026-10-23T00:10:00Z',
      target:{database:'talo_mos_v4_test',host:'localhost',nodeEnv:'test'},status:'FAIL',suites:[{
        key:'HOST',label:'Host integration',command:'npm test',status:'FAIL',durationMs:30000,exitCode:1,tests:{passed:19,failed:1,skipped:0},summary:['1 test failed: CONTRACT']
      }] }},runner:{apiExecution:false,mode:'CLI'}};
    const txt=resultsReportTxt(v);
    expect(txt).toContain('REG2');expect(txt).toContain('1 test failed: CONTRACT');
    expect(txt).toContain('19 passed, 1 failed');
  });
});
