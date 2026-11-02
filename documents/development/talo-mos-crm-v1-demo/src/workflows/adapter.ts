/* REV02 demo projection — reuses cm_customer_activities (11-table baseline).
   NO new database tables, columns or HTTP endpoints. Appointment details and
   report details are encoded in existing description text as a mock-only
   presentation convention, NOT a supported production data contract. */
import type {Activity,Customer,PersonaId} from '../domain/types';
import {crmApi,getDB,can} from '../mock/service';

export const APPOINTMENT='MEETING';
export const TASK_TYPES=['TASK','FOLLOW_UP'] as const;
export const REPORT_MARK='[CRM_DEMO_WORK_REPORT_V1]';
export const SCHEDULE_MARK='[CRM_DEMO_APPOINTMENT_V1]';
export type ReportFields={performed:string;result:string;issues:string;next:string;origin:string};
export type ScheduleFields={location:string;plan:string;remindMinutes:number};
export const isMeeting=(a:Activity)=>a.activity_type_code===APPOINTMENT;
export const isTodo=(a:Activity)=>TASK_TYPES.includes(a.activity_type_code as typeof TASK_TYPES[number]);
export const isWorkReport=(a:Activity)=>a.activity_type_code==='NOTE'&&!!a.description?.startsWith(REPORT_MARK);
export function encodeAppointment(v:ScheduleFields){return `${SCHEDULE_MARK}\nĐịa điểm: ${v.location}\nNội dung dự kiến: ${v.plan}\nNhắc trước (phút): ${v.remindMinutes}`;}
export function parseAppointment(a:Activity):ScheduleFields{const s=a.description||'';if(!s.startsWith(SCHEDULE_MARK))return {location:'Chưa ghi nhận',plan:s,remindMinutes:30};const get=(k:string)=>s.split('\n').find(x=>x.startsWith(k))?.slice(k.length)||'';return {location:get('Địa điểm: '),plan:get('Nội dung dự kiến: '),remindMinutes:Number(get('Nhắc trước (phút): '))||30};}
export function encodeReport(v:ReportFields){return `${REPORT_MARK}\nNội dung đã làm: ${v.performed}\nKết quả: ${v.result}\nVấn đề: ${v.issues}\nCần tiếp tục: ${v.next}\nHoạt động gốc (liên kết mô phỏng): ${v.origin}`;}
export function parseReport(a:Activity):ReportFields{const s=a.description||'';const get=(k:string)=>s.split('\n').find(x=>x.startsWith(k))?.slice(k.length)||'';return {performed:get('Nội dung đã làm: '),result:get('Kết quả: '),issues:get('Vấn đề: '),next:get('Cần tiếp tục: '),origin:get('Hoạt động gốc (liên kết mô phỏng): ')};}
export function customerActivities(customers:Customer[],customerId?:string){const ids=new Set(customers.map(c=>c.customer_id));return getDB().activities.filter(a=>ids.has(a.customer_id)&&(!customerId||a.customer_id===customerId));}
export function referenceClock(){return new Date(getDB().clock+'T10:00:00+07:00');}
export function isOverdue(a:Activity){return !!a.due_at&&a.activity_status_code==='OPEN'&&new Date(a.due_at).getTime()<referenceClock().getTime()}
export function reminders(a:Activity,now=referenceClock()){if(!isMeeting(a)||a.activity_status_code!=='OPEN')return false;const delta=new Date(a.occurred_at).getTime()-now.getTime();const r=parseAppointment(a).remindMinutes;return delta>=0&&delta<=r*60000;}
export function upcoming(a:Activity){return isMeeting(a)&&a.activity_status_code==='OPEN'&&new Date(a.occurred_at)>=referenceClock();}
export function allowedCustomer(customers:Customer[],id:string){return customers.some(c=>c.customer_id===id)}
export async function createTodo(persona:PersonaId,customerId:string,input:{title:string;description:string;due_at:string;assigned_to_account_id:string}){if(!can(persona,'activity.create'))throw new Error('Không có quyền tạo công việc');return crmApi.call<Activity>(`/api/cm/customers/${customerId}/activities`,{method:'POST',persona,body:{...input,activity_type_code:'TASK',due_at:input.due_at||null}})}
export async function createAppointment(persona:PersonaId,customerId:string,input:{title:string;start:string;location:string;plan:string;remindMinutes:number;assigned_to_account_id:string}){if(!can(persona,'activity.create'))throw new Error('Không có quyền tạo lịch hẹn');return crmApi.call<Activity>(`/api/cm/customers/${customerId}/activities`,{method:'POST',persona,body:{title:input.title,activity_type_code:'MEETING',occurred_at:new Date(input.start).toISOString(),description:encodeAppointment({location:input.location,plan:input.plan,remindMinutes:input.remindMinutes}),assigned_to_account_id:input.assigned_to_account_id}})}
export async function patchTodo(persona:PersonaId,id:string,input:{title:string;description:string;due_at:string}){return crmApi.call<Activity>(`/api/cm/activities/${id}`,{method:'PATCH',persona,body:{title:input.title,description:input.description,due_at:input.due_at||null}})}
export async function patchAppointment(persona:PersonaId,id:string,input:{title:string;start:string;location:string;plan:string;remindMinutes:number}){return crmApi.call<Activity>(`/api/cm/activities/${id}`,{method:'PATCH',persona,body:{title:input.title,occurred_at:new Date(input.start).toISOString(),description:encodeAppointment(input)}})}
export async function cancelAppointment(persona:PersonaId,id:string){return crmApi.call<Activity>(`/api/cm/activities/${id}`,{method:'PATCH',persona,body:{activity_status_code:'CANCELLED'}})}
export async function completeTask(persona:PersonaId,id:string){return crmApi.call<Activity>(`/api/cm/activities/${id}/complete`,{method:'POST',persona})}
export async function createReport(persona:PersonaId,customerId:string,input:{title:string;performed:string;result:string;issues:string;next:string;origin:string;performedDate?:string}){if(!can(persona,'activity.create')||!can(persona,'activity.update'))throw new Error('Thiếu quyền tạo và hoàn thành hoạt động');const desc=encodeReport(input);const a=await crmApi.call<Activity>(`/api/cm/customers/${customerId}/activities`,{method:'POST',persona,body:{title:input.title,activity_type_code:'NOTE',description:desc,occurred_at:input.performedDate?new Date(input.performedDate+'T10:00:00+07:00').toISOString():undefined,assigned_to_account_id:persona}});await completeTask(persona,a.activity_id);return a;}
