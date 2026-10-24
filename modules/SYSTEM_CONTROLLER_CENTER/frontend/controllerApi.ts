export type ApiRow=Record<string,unknown>;
export interface ListResult { scope:string; page:number; pageSize:number; hasNext:boolean; rows:ApiRow[]; assumption?:string; moduleKey?:string; accountId?:string; }
function isRecord(x:unknown):x is Record<string,unknown>{return typeof x==='object'&&x!==null&&!Array.isArray(x);}
export async function controllerList(path:string,onSessionLost:()=>void):Promise<ListResult>{
 const res=await fetch(`/api/system-controller-center/${path}`,{credentials:'same-origin',headers:{Accept:'application/json'},cache:'no-store'});
 if(res.status===401){onSessionLost();throw new Error('Phiên đã hết hạn.');}
 const body:unknown=await res.json();
 if(!res.ok){const e=isRecord(body)&&isRecord(body.error)?body.error:{};throw new Error(typeof e.message==='string'?e.message:`HTTP ${res.status}`);}
 const x=isRecord(body)?body.data:null;
 if(!isRecord(x)||typeof x.scope!=='string'||typeof x.page!=='number'||typeof x.pageSize!=='number'||typeof x.hasNext!=='boolean'||!Array.isArray(x.rows)||!x.rows.every(isRecord))
  throw new Error('API không đúng hợp đồng; dữ liệu chưa xác minh.');
 return {scope:x.scope,page:x.page,pageSize:x.pageSize,hasNext:x.hasNext,rows:x.rows,
  ...(typeof x.assumption==='string'?{assumption:x.assumption}:{}),
  ...(typeof x.moduleKey==='string'?{moduleKey:x.moduleKey}:{}),
  ...(typeof x.accountId==='string'?{accountId:x.accountId}:{})};
}
export function exportTxt(title:string,rows:readonly ApiRow[],note=''){
 const header=`TALO-MOS · SYSTEM CONTROLLER CENTER\n${title}\nExported ${new Date().toISOString()}\n${note}\nRead-only; current page only.\n\n`;
 const text=header+rows.map((row,i)=>`${i+1}. ${Object.entries(row).map(([k,v])=>`${k}: ${typeof v==='string'?v:JSON.stringify(v)}`).join(' | ')}`).join('\n');
 const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=`SCC_${title.replace(/[^a-z0-9_-]/gi,'_')}_${Date.now()}.txt`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
export function printable(v:unknown):string {if(v===null||v===undefined)return '—';if(Array.isArray(v))return v.join(', ');return typeof v==='object'?JSON.stringify(v):String(v);}

/** Exports complete *paginated* reports, never silently reports a partial export as complete. */
export async function exportAll(path:string,title:string,onSessionLost:()=>void,note=''){
 const all:ApiRow[]=[];let finished=false;let pages=0;
 for(let p=1;p<=200;p++){
  const sep=path.includes('?')?'&':'?';
  const result=await controllerList(`${path}${sep}page=${p}`,onSessionLost);
  all.push(...result.rows);pages=p;
  if(!result.hasNext){finished=true;break;}
 }
 if(!finished)throw new Error('Báo cáo vượt giới hạn 200 trang: từ chối xuất tệp không đầy đủ.');
 exportTxt(title,all,`${note}
Full pagination complete: ${pages} page(s), ${all.length} row(s).`);
}
