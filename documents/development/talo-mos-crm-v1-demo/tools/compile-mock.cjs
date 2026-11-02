const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
let ts;try{ts=require('typescript')}catch{try{ts=require(path.join(cp.execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'))}catch{throw Error('Need TypeScript (npm install or npm install -g typescript)')}}
const root=path.resolve(__dirname,'..');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'talo-cm-test-'));
for(const p of ['src/domain/types.ts','src/mock/seed.ts','src/mock/service.ts','src/mock/handlers.ts','src/workflows/adapter.ts']){
 const input=path.join(root,p),target=path.join(out,p.replace(/\.ts$/,'.js'));
 fs.mkdirSync(path.dirname(target),{recursive:true});
 const r=ts.transpileModule(fs.readFileSync(input,'utf8'),{fileName:p,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 if(r.diagnostics?.length)throw Error('TS syntax issue: '+p+' '+r.diagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')));
 fs.writeFileSync(target,r.outputText);
}
module.exports={dir:out,db:require(path.join(out,'src/mock/service.js')),types:require(path.join(out,'src/domain/types.js')),handler:require(path.join(out,'src/mock/handlers.js')),workflow:require(path.join(out,'src/workflows/adapter.js')),schema:require(path.join(root,'src/data/database-dictionary.json'))};
