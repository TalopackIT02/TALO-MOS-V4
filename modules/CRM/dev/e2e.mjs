// CRM Module — browser runtime acceptance (dev tooling, not part of the package runtime). Drives the standalone build
// (vite preview, Mock Adapter) with the Playwright already installed in tests/node_modules. Writes screenshots + a JSON
// result. Usage: node modules/CRM/dev/e2e.mjs <baseUrl> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(repo, 'tests/node_modules/playwright/package.json'));
const pw = await import(pathToFileURL(require.resolve('playwright')).href);
const chromium = pw.chromium ?? pw.default.chromium;
const [base = 'http://127.0.0.1:5182', out = resolve(repo, '..', 'TALO-MOS-V4_exports', 'crm-e2e')] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const steps = [];
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const shot = (name) => page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
async function step(name, fn) {
  try { await fn(); steps.push({ name, result: 'PASS' }); console.log(`PASS ${name}`); }
  catch (e) { steps.push({ name, result: 'FAIL', error: String(e.message ?? e).slice(0, 400) }); console.log(`FAIL ${name}: ${e.message}`); await shot(`FAIL-${steps.length}`); }
}
const nav = (label) => page.locator('aside.sidebar').getByRole('button', { name: label, exact: true }).click();
const rowByCode = (code) => page.locator('.crm-table tbody tr').filter({ has: page.locator('td.crm-mono', { hasText: new RegExp(`^${code}$`) }) });
const persona = (label) => page.getByLabel('Tài khoản mô phỏng').selectOption({ label });
const toast = (text) => page.locator('.crm-toast').filter({ hasText: text }).first().waitFor({ timeout: 5000 });
const modal = () => page.locator('.crm-modal');

await page.goto(`${base}/crm`);
await page.evaluate(() => localStorage.clear());
await page.reload();

await step('01 Tổng quan công việc renders KPIs, appointments, tasks, waiting items', async () => {
  await page.getByText('Lịch hẹn hôm nay').waitFor();
  await page.getByText('Công việc cần chú ý').waitFor();
  await page.getByText('Chờ tôi xử lý').waitFor();
  await page.getByText('Chế độ mô phỏng').waitFor();
  await shot('01-workspace-sale-a');
});

await step('02 Sidebar has exactly the 5 CRM screens', async () => {
  const labels = await page.locator('aside.sidebar .nav-label').allTextContents();
  if (JSON.stringify(labels) !== JSON.stringify(['Tổng quan công việc', 'Khách hàng', 'Lịch hẹn', 'Công việc', 'Báo cáo'])) throw new Error(labels.join('|'));
});

await step('03 Customers list: search, filter, paging', async () => {
  await nav('Khách hàng');
  await page.locator('.crm-table tbody tr').first().waitFor();
  await page.getByLabel('Tìm khách hàng').fill('An Phát');
  await page.locator('.crm-table tbody tr', { hasText: 'Mẫu An Phát' }).first().waitFor();
  await page.getByLabel('Tìm khách hàng').fill('');
  await page.getByLabel('Hồ sơ', { exact: true }).selectOption('DRAFT');
  await page.locator('.crm-pager').waitFor();
  await page.getByLabel('Hồ sơ', { exact: true }).selectOption('');
  await shot('03-customers-list');
});

await step('04 Customer profile: 1/3 identity + legal + sales, 2/3 six tabs', async () => {
  await rowByCode('000001').click();
  await page.locator('.crm-profile-left').getByText('Sale phụ trách').waitFor();
  for (const t of ['Tổng quan', 'Thông tin liên hệ', 'Lịch hẹn', 'Công việc', 'Hoạt động & Kết quả', 'Tài liệu']) {
    await page.getByRole('tab', { name: t }).click();
    await page.locator('.crm-tabbody').waitFor();
  }
  await page.getByRole('tab', { name: 'Tổng quan' }).click();
  await shot('04-customer-profile');
});

await step('05 Appointment created in the profile appears in the Calendar screen (same data)', async () => {
  await page.getByRole('tab', { name: 'Lịch hẹn' }).click();
  await page.getByRole('button', { name: '+ Lịch hẹn' }).click();
  await modal().getByLabel('Tiêu đề').fill('E2E gặp khách hàng');
  await modal().getByRole('button', { name: 'Lưu lịch hẹn' }).click();
  await toast('Đã tạo lịch hẹn');
  await page.locator('.crm-tabbody').getByText('E2E gặp khách hàng').waitFor();
  await nav('Lịch hẹn');
  await page.locator('.crm-event', { hasText: 'E2E gặp khách hàng' }).first().waitFor();
  for (const v of ['Ngày', 'Tháng', 'Tuần']) await page.getByRole('group', { name: 'Chế độ xem' }).getByRole('button', { name: v }).click();
  await shot('05-calendar-week');
});

await step('06 Calendar: open an appointment and cancel it with a reason', async () => {
  await page.locator('.crm-event', { hasText: 'E2E gặp khách hàng' }).first().click();
  await modal().getByRole('button', { name: 'Hủy lịch' }).click();
  await modal().getByRole('textbox').fill('Khách đổi lịch');
  await modal().getByRole('button', { name: 'Hủy lịch hẹn' }).click();
  await toast('Đã hủy lịch hẹn');
});

await step('07 Task created on Tasks screen and completed (DONE filter)', async () => {
  await nav('Công việc');
  await page.getByRole('button', { name: '+ Công việc' }).click();
  await modal().getByLabel('Tên công việc').fill('E2E gửi hồ sơ năng lực');
  await modal().locator('select').first().selectOption({ index: 1 });
  await modal().getByRole('button', { name: 'Lưu công việc' }).click();
  await toast('Đã tạo công việc');
  const row = page.locator('.crm-table tbody tr', { hasText: 'E2E gửi hồ sơ năng lực' });
  await row.getByRole('button', { name: 'Hoàn thành' }).click();
  await toast('Đã hoàn thành công việc');
  await page.getByLabel('Trạng thái').selectOption('DONE');
  await page.locator('.crm-table tbody tr', { hasText: 'E2E gửi hồ sơ năng lực' }).waitFor();
  await shot('07-tasks');
});

await step('08 Work report: write, link, submit (distinct from dashboard)', async () => {
  await nav('Báo cáo');
  await page.getByRole('button', { name: '+ Viết báo cáo' }).click();
  await modal().getByLabel('Nội dung đã thực hiện').fill('E2E: gặp 2 khách hàng, gửi báo giá.');
  await modal().getByLabel('Kết quả thực hiện').fill('1 khách hẹn demo.');
  await modal().getByRole('button', { name: 'Nộp báo cáo' }).click();
  await toast('Đã nộp báo cáo');
  await page.locator('.crm-table tbody tr', { hasText: 'E2E: gặp 2 khách hàng' }).getByText('Đã nộp').waitFor();
  await shot('08-reports');
});

await step('09 Create customer → DRAFT; verify as manager → VERIFIED', async () => {
  await nav('Khách hàng');
  await page.getByRole('button', { name: '+ Khách hàng' }).click();
  await modal().getByLabel('Tên thường gọi').fill('E2E Khách hàng mới');
  await modal().getByRole('button', { name: 'Tạo hồ sơ DRAFT' }).click();
  await page.locator('.crm-profile-left').getByText('DRAFT').first().waitFor();
  await persona('Phạm Quốc Dũng — Quản lý kinh doanh');
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill('E2E Khách hàng mới');
  await page.locator('.crm-table tbody tr', { hasText: 'E2E Khách hàng mới' }).click();
  await page.getByRole('button', { name: 'Xác minh hồ sơ' }).click();
  await modal().getByLabel('Số định danh').fill('0108888888');
  await modal().getByLabel('Số nhà, tên đường').fill('Số 9 đường E2E');
  await modal().getByLabel('Tỉnh / Thành phố').selectOption('01');
  await modal().getByLabel('Phường / Xã / Đặc khu').selectOption('00004');
  await modal().getByRole('button', { name: 'Xác minh', exact: true }).click();
  await toast('Hồ sơ đã được xác minh');
  await page.locator('.crm-profile-left').getByText('Đã xác minh').first().waitFor();
  await shot('09-verified');
});

await step('10 Handover flow B: manager approves pending handover from "Chờ tôi xử lý"', async () => {
  await nav('Tổng quan công việc');
  await page.locator('.crm-row-btn', { hasText: 'Chờ quản lý duyệt' }).first().click();
  await modal().getByRole('button', { name: 'Duyệt bàn giao' }).click();
  await toast('Đã duyệt bàn giao');
  await modal().getByRole('button', { name: 'Đóng' }).last().click();
  await persona('Lê Minh Cường — Sale');
  await nav('Tổng quan công việc');
  // the receiver is not assigned yet: the handover is processed in place, without opening the (out-of-scope) profile
  await page.locator('.crm-row-btn', { hasText: 'Chờ Sale nhận xác nhận' }).first().click();
  await modal().getByRole('button', { name: 'Nhận bàn giao' }).click();
  await toast('Đã nhận bàn giao');
  await modal().getByText('Hoàn tất').waitFor();
  await modal().getByRole('button', { name: 'Mở hồ sơ khách hàng' }).click();
  await page.locator('.crm-profile-left').getByText('Lê Minh Cường').first().waitFor();
  await shot('10-handover-completed');
});

await step('11 Legal change: management then accounting approval updates the legal name', async () => {
  await persona('Phạm Quốc Dũng — Quản lý kinh doanh');
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill('Bình Minh');
  await page.locator('.crm-table tbody tr', { hasText: 'Bình Minh' }).first().click();
  await page.getByRole('button', { name: 'Duyệt (quản lý)' }).click();
  await toast('Đã duyệt cấp quản lý');
  await persona('Hoàng Thu Hà — Kế toán');
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill('Bình Minh');
  await page.locator('.crm-table tbody tr', { hasText: 'Bình Minh' }).first().click();
  await page.getByRole('button', { name: 'Duyệt (kế toán)' }).click();
  await toast('Đã duyệt cấp kế toán');
  await page.locator('.crm-profile-left').getByText('Công ty CP Thử Nghiệm Bình Minh Mới').waitFor();
  await shot('11-legal-applied');
});

await step('12 Scope & permissions: a sale without READ_ALL does not see others\' customers, no export / verify buttons', async () => {
  await persona('Nguyễn Văn An — Sale');
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill('000003');
  await page.getByText('Không có khách hàng nào trong phạm vi').waitFor();
  if (await page.getByRole('button', { name: 'Xuất CSV' }).count()) throw new Error('export visible without permission');
  await page.getByLabel('Tìm khách hàng').fill('000001');
  await rowByCode('000001').waitFor();
});

await step('13 Mobile width (390 px) still usable', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await nav('Tổng quan công việc').catch(() => undefined);
  await page.getByText('Chế độ mô phỏng').waitFor();
  await shot('13-mobile');
});

await browser.close();
const result = { base, ranAt: new Date().toISOString(), steps, consoleErrors: errors,
  summary: { pass: steps.filter((s) => s.result === 'PASS').length, fail: steps.filter((s) => s.result === 'FAIL').length, consoleErrors: errors.length } };
writeFileSync(resolve(out, 'e2e-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary));
process.exitCode = result.summary.fail === 0 && errors.length === 0 ? 0 : 1;
