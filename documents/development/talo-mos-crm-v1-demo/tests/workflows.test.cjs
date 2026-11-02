const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {db,workflow:w,schema}=require('../tools/compile-mock.cjs');
const C='demo-cust-1';
beforeEach(()=>db.reset());
const scoped=()=>db.getDB().customers.filter(c=>c.customer_id===C);

test('W01 Calendar — tạo từ hồ sơ và xem từ Calendar dùng cùng activity',async()=>{
 const a=await w.createAppointment('sale_a',C,{title:'Hẹn demo 1',start:'2026-10-29T10:20:00+07:00',location:'Văn phòng mẫu',plan:'Trao đổi sản phẩm',remindMinutes:30,assigned_to_account_id:'sale_a'});
 assert.equal(a.activity_type_code,'MEETING');assert.equal(a.occurred_at,'2026-10-29T03:20:00.000Z');
 assert.ok(w.customerActivities(scoped(),C).some(x=>x.activity_id===a.activity_id));
 assert.ok(w.customerActivities(scoped()).some(x=>x.activity_id===a.activity_id));
 assert.equal(w.parseAppointment(a).location,'Văn phòng mẫu');assert.equal(w.reminders(a),true);
});
test('W02 Calendar — chỉnh sửa ngày giờ và địa điểm bằng PATCH cũ',async()=>{
 const a=await w.createAppointment('sale_a',C,{title:'Cuộc hẹn 1',start:'2026-10-30T11:00',location:'A',plan:'B',remindMinutes:15,assigned_to_account_id:'sale_a'});
 const b=await w.patchAppointment('sale_a',a.activity_id,{title:'Hẹn đổi giờ',start:'2026-10-31T12:45',location:'C',plan:'D',remindMinutes:30});
 assert.equal(b.title,'Hẹn đổi giờ');assert.equal(w.parseAppointment(b).plan,'D');assert.ok(b.occurred_at.includes('T12:45'));
});
test('W03 Calendar — hủy lịch kiểm tra quyền, không xóa dữ liệu',async()=>{
 const a=await w.createAppointment('sale_a',C,{title:'Lịch được hủy',start:'2026-11-03T11:00',location:'',plan:'',remindMinutes:30,assigned_to_account_id:'sale_a'});
 await assert.rejects(w.cancelAppointment('accounting',a.activity_id),e=>e.code==='CM_PERMISSION_DENIED');
 const b=await w.cancelAppointment('sale_a',a.activity_id);assert.equal(b.activity_status_code,'CANCELLED');assert.equal(w.customerActivities(scoped()).find(x=>x.activity_id===a.activity_id).activity_status_code,'CANCELLED');
});
test('W04 Task — tạo từ hồ sơ và Task List dùng chung dữ liệu',async()=>{
 const a=await w.createTodo('sale_a',C,{title:'Gọi lại khách',description:'Ghi chú thử',due_at:'2026-10-30',assigned_to_account_id:'sale_a'});
 assert.equal(a.activity_type_code,'TASK');assert.ok(w.customerActivities(scoped()).some(x=>x.activity_id===a.activity_id));assert.ok(w.customerActivities(scoped(),C).some(x=>x.activity_id===a.activity_id));
});
test('W05 Task — cập nhật, hoàn thành và không tự tạo Calendar',async()=>{
 const a=await w.createTodo('sale_a',C,{title:'Gửi mẫu',description:'',due_at:'2026-11-01',assigned_to_account_id:'sale_a'});
 await w.patchTodo('sale_a',a.activity_id,{title:'Gửi mẫu bản sửa',description:'Bổ sung',due_at:'2026-11-02'});
 const done=await w.completeTask('sale_a',a.activity_id);assert.equal(done.activity_status_code,'DONE');assert.equal(done.title,'Gửi mẫu bản sửa');assert.equal(w.isMeeting(done),false);
});
test('W06 Task — overdue dựa trên demo clock',()=>{const a=db.getDB().activities.find(x=>x.activity_id==='demo-act-6');assert.ok(w.isOverdue(a));db.advanceClock(10);assert.ok(w.isOverdue(a))});
test('W07 Report — lập báo cáo NOTE có kết quả, liên kết văn bản với To-do',async()=>{
 const a=await w.createTodo('sale_a',C,{title:'Gọi khách demo',description:'',due_at:'2026-10-29',assigned_to_account_id:'sale_a'});
 const result=await w.createReport('sale_a',C,{title:'Kết quả gọi khách',performed:'Đã gọi',result:'Đồng ý gặp',issues:'Không có',next:'Hẹn lịch',origin:a.activity_id});
 const b=db.getDB().activities.find(x=>x.activity_id===result.activity_id);
 assert.equal(b.activity_status_code,'DONE');assert.equal(w.isWorkReport(b),true);assert.deepEqual(w.parseReport(b),{performed:'Đã gọi',result:'Đồng ý gặp',issues:'Không có',next:'Hẹn lịch',origin:a.activity_id});
 assert.ok(w.customerActivities(scoped()).some(x=>x.activity_id===result.activity_id));
});
test('W08 IAM — khác scope không thể tạo báo cáo khách',async()=>{
 await assert.rejects(w.createReport('sale_c',C,{title:'Không hợp lệ',performed:'X',result:'Y',issues:'',next:'',origin:''}),e=>e.code==='CM_CUSTOMER_NOT_FOUND');
});
test('W09 phân biệt MEETING / TASK / NOTE báo cáo',()=>{const act=db.getDB().activities;assert.ok(act.some(w.isMeeting));assert.ok(act.some(w.isTodo));assert.ok(act.some(w.isWorkReport));assert.equal(w.isTodo(act.find(x=>x.activity_id==='demo-act-2')),false)});
test('W10 API Contract không tăng endpoint, schema không tăng bảng/cột',()=>{assert.equal(db.API_ROUTES.length,40);assert.equal(new Set(schema.columns.map(c=>c.table)).size,15);assert.equal(schema.columns.length,173)});
test('W11 Sidebar chứa chính xác năm mục, không có quản trị ẩn',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../src/app/App.tsx'),'utf8');const v=s.match(/const navs:[^;]+;/)[0];
 assert.equal((v.match(/\['\//g)||[]).length,4);assert.ok(v.includes("['','Tổng quan công việc'"));for(const name of ['Khách hàng','Lịch hẹn','Công việc','Báo cáo'])assert.ok(v.includes(`'${name}'`));
 for(const forbidden of ['Phê duyệt pháp lý','Nhóm ngành','Tài liệu hết hạn','Demo IAM'])assert.equal(v.includes(forbidden),false);
});
test('W12 Các tab hồ sơ theo handoff và routes Calendar/To-do/Report',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../src/app/App.tsx'),'utf8');
 assert.ok(s.includes("['Tổng quan','Thông tin liên hệ','Lịch hẹn','Công việc','Hoạt động & Kết quả','Tài liệu']"));
 for(const route of ["activePath==='/schedule'","activePath==='/reports'","activePath==='/tasks'"])assert.ok(s.includes(route));
});
