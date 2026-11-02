// CRM Module — browser runtime acceptance (dev tooling, not part of the package runtime). Drives the standalone build
// (vite preview, Mock Adapter) with the Playwright already installed in tests/node_modules. Writes screenshots + a JSON
// result. Usage: node modules/CRM/dev/e2e.mjs <baseUrl> <outDir>
// Rules: every step asserts something observable; navigation failures are NOT swallowed (no catch-and-continue).
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

const SCREENS = ['Tổng quan công việc', 'Khách hàng', 'Lịch hẹn', 'Công việc', 'Báo cáo'];
const TABS = ['Tổng quan', 'Thông tin liên hệ', 'Lịch hẹn', 'Công việc', 'Hoạt động & Kết quả', 'Tài liệu'];
const HEADERS = ['Mã KH', 'Tên thường gọi', 'Tên pháp lý', 'Định danh', 'Loại', 'Tỉnh / Quốc gia', 'Miền / Vùng', 'Quan hệ', 'Hồ sơ', 'Sale chính', 'Ngày tạo', 'Thao tác'];
const P = { A: 'Nguyễn Văn An — Sale', B: 'Trần Thị Bình — Sale', C: 'Lê Minh Cường — Sale', MGR: 'Phạm Quốc Dũng — Quản lý kinh doanh',
  ACC: 'Hoàng Thu Hà — Kế toán', VIEW: 'Vũ Thị Lan — Chăm sóc khách hàng (chỉ xem)' };

const steps = [];
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const shot = (name) => page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
async function step(name, fn) {
  try { await fn(); steps.push({ name, result: 'PASS' }); console.log(`PASS ${name}`); }
  catch (e) {
    steps.push({ name, result: 'FAIL', error: String(e.message ?? e).slice(0, 500) }); console.log(`FAIL ${name}: ${String(e.message).split(/\r?\n/)[0]}`); await shot(`FAIL-${steps.length}`);
    await page.goto(`${base}/crm`); // isolate the next step from a dialog left open by this failure (the failure itself stays recorded)
  }
}
// Select the option whose text matches (Playwright selectOption does not accept a RegExp label).
async function selectByText(select, re) {
  const value = await select.evaluate((el, src) => [...el.options].find((o) => new RegExp(src).test(o.text))?.value ?? null, re.source);
  if (value === null) throw new Error(`no option matching ${re}`);
  await select.selectOption(value);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const narrow = () => (page.viewportSize()?.width ?? 1440) <= 760;
// Drawer fully slid in (transform transition finished) and its labels readable.
async function openDrawer() {
  await page.locator('#mobileBottomMenu').click();
  await page.locator('.app-shell.mobile-open').waitFor();
  await page.waitForFunction(() => { const r = document.querySelector('aside.sidebar')?.getBoundingClientRect(); return r !== undefined && Math.abs(r.left) < 1; });
  const w = await page.locator('aside.sidebar .nav-label').first().evaluate((el) => el.getBoundingClientRect().width);
  expect(w > 40, 'drawer labels not readable');
}
// Sidebar navigation; on narrow screens the sidebar is a drawer opened from the bottom navigation "Menu".
async function nav(label) {
  if (narrow()) {
    await openDrawer();
  }
  await page.locator('aside.sidebar').getByRole('button', { name: label, exact: true }).click();
  await page.locator('#title').filter({ hasText: label.toLocaleUpperCase('vi') }).waitFor();
  if (narrow()) {
    expect(await page.locator('.app-shell.mobile-open').count() === 0, 'drawer did not close after navigation');
    // wait for the slide-out transition to finish (the drawer must end fully off-screen)
    await page.waitForFunction(() => (document.querySelector('aside.sidebar')?.getBoundingClientRect().right ?? 0) <= 0);
  }
}
const rowByCode = (code) => page.locator('.crm-table tbody tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${code}$`) }) });
const persona = (label) => page.getByLabel('Tài khoản mô phỏng').selectOption({ label });
const toast = (text) => page.locator('.crm-toast').filter({ hasText: text }).first().waitFor({ timeout: 5000 });
const modal = () => page.locator('.crm-modal').last();
// Form control by its visible field caption (Field wraps the control in a <label>, so accessible names include option text).
const field = (caption) => modal().locator('label.crm-field').filter({ has: page.locator('xpath=./span', { hasText: new RegExp(`^${caption}( \\*)?$`) }) }).locator('input, select, textarea').first();
const tabSelected = async (name) => (await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected')) === 'true';
async function openCustomer(code) {
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill(code);
  await rowByCode(code).getByRole('button', { name: 'Xem hồ sơ' }).click();
  await page.locator('.crm-profile-title').filter({ hasText: code }).waitFor();
}
// The element at the centre of a locator must be the locator itself (not covered by the bottom nav, a toast, …).
async function notCovered(locator, what) {
  await locator.scrollIntoViewIfNeeded();
  const ok = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  });
  expect(ok, `${what} is covered by another element`);
}
const noPageOverflow = async (what) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${what}: horizontal page scroll`);

await page.goto(`${base}/crm`);
await page.evaluate(() => localStorage.clear());
await page.reload();

// ------------------------------------------------------------------------------------------------ desktop flows
await step('01 Tổng quan công việc: KPI, lịch, việc, chờ xử lý, cảnh báo tài liệu, nhãn DEMO', async () => {
  for (const t of ['Khách hàng đang phụ trách', 'Lịch hẹn hôm nay', 'Công việc chưa hoàn thành', 'Chờ tôi xử lý', 'Tài liệu sắp / đã hết hạn', 'DEMO — IAM GIẢ LẬP'])
    await page.getByText(t).first().waitFor();
  await page.getByLabel('Kỳ thống kê').selectOption('month');
  await shot('01-workspace-sale-a');
});

await step('02 Sidebar có đúng 5 màn hình; AppShell 4 khối', async () => {
  const labels = await page.locator('aside.sidebar .nav-label').allTextContents();
  expect(JSON.stringify(labels) === JSON.stringify(SCREENS), labels.join('|'));
  for (const sel of ['header.top', 'aside.sidebar', '#crumb', '#title', '#desc', '#tabs', 'section.panel']) expect(await page.locator(sel).count() === 1, `missing ${sel}`);
  expect(await page.locator('.brand img.brand-symbol').count() === 1, 'logo missing');
});

await step('03 KPI quá hạn mở màn Công việc với bộ lọc quá hạn', async () => {
  await nav('Tổng quan công việc');
  await page.locator('.crm-kpi', { hasText: 'Công việc quá hạn' }).click();
  await page.locator('#title').filter({ hasText: 'CÔNG VIỆC' }).waitFor();
  await page.locator('.crm-kpi.active', { hasText: 'Quá hạn' }).waitFor();
  await page.locator('.crm-table tbody tr', { hasText: 'Cập nhật hồ sơ pháp lý còn thiếu' }).waitFor();
});

await step('04 Danh sách khách hàng: 12 cột, tìm kiếm, lọc Miền, sắp xếp, số dòng/trang', async () => {
  await nav('Khách hàng');
  await page.locator('.crm-table tbody tr').first().waitFor();
  const heads = (await page.locator('.crm-table thead th').allTextContents()).map((h) => h.replace(/[▲▼]/g, '').trim());
  expect(JSON.stringify(heads) === JSON.stringify(HEADERS), `headers: ${heads.join('|')}`);
  await page.getByLabel('Tìm khách hàng').fill('An Phát');
  await page.locator('.crm-table tbody tr', { hasText: 'Mẫu An Phát' }).first().waitFor();
  await page.getByLabel('Tìm khách hàng').fill('');
  await page.getByLabel('Miền', { exact: true }).selectOption('SOUTH');
  await page.waitForTimeout(150);
  const regions = await page.locator('.crm-table tbody tr td:nth-child(7)').allTextContents();
  expect(regions.length > 0 && regions.every((r) => r.includes('Miền Nam')), `macro filter: ${regions.join('|')}`);
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await page.getByRole('button', { name: /^Mã KH/ }).click(); // asc → desc
  await page.locator('th[aria-sort="descending"]').waitFor();
  const codes = await page.locator('.crm-table tbody tr td:first-child').allTextContents();
  expect(codes.length > 1 && codes[0] > codes[codes.length - 1], `sort desc: ${codes.slice(0, 3).join(',')}`);
  await page.getByLabel('Số dòng mỗi trang').selectOption('10');
  await page.waitForTimeout(100);
  expect(await page.locator('.crm-table tbody tr').count() <= 10, 'page size 10 not applied');
  await shot('04-customers-list');
});

await step('05 Bấm tên → xem nhanh → mở hồ sơ', async () => {
  await page.getByRole('button', { name: /^Mã KH/ }).click(); // back to asc
  await rowByCode('000001').locator('.crm-name-link').click();
  await modal().getByText('Tên pháp lý').waitFor();
  await shot('05-quickview');
  expect(await modal().getByRole('button', { name: 'Ẩn hồ sơ' }).count() === 0, 'hide offered without crm.customer.hide');
  await modal().getByRole('button', { name: /^Mở hồ sơ/ }).click();
  await page.locator('.crm-profile-title').filter({ hasText: '000001' }).waitFor();
});

await step('06 Hồ sơ: 1/3 trái (định danh, pháp lý, trạng thái, địa chỉ, Sale) + đúng 6 tab', async () => {
  for (const t of ['Sale phụ trách', 'Miền / Vùng', 'Ngày tạo']) await page.locator('.crm-profile-left').getByText(t).first().waitFor();
  const tabs = await page.getByRole('tab').allTextContents();
  expect(JSON.stringify(tabs) === JSON.stringify(TABS), `tabs: ${tabs.join('|')}`);
  for (const t of TABS) { await page.getByRole('tab', { name: t, exact: true }).click(); expect(await tabSelected(t), `tab ${t}`); }
  await page.getByRole('tab', { name: 'Tổng quan', exact: true }).click();
  await shot('06-customer-profile');
});

await step('07 Lịch hẹn tạo trong hồ sơ (có người liên hệ) hiện ở màn Lịch hẹn; từ Lịch mở lại đúng tab hồ sơ', async () => {
  await page.getByRole('tab', { name: 'Lịch hẹn', exact: true }).click();
  await page.locator('.crm-tabbody').getByRole('button', { name: '+ Lịch hẹn' }).click();
  await modal().getByLabel('Tiêu đề').fill('E2E gặp khách hàng');
  await modal().getByLabel('Người liên hệ').selectOption({ index: 1 });
  await modal().getByRole('button', { name: 'Lưu lịch hẹn' }).click();
  await toast('Đã tạo lịch hẹn');
  await page.locator('.crm-tabbody').getByText('E2E gặp khách hàng').waitFor();
  await nav('Lịch hẹn');
  for (const v of ['Ngày', 'Tháng', 'Tuần']) await page.getByRole('group', { name: 'Chế độ xem' }).getByRole('button', { name: v }).click();
  await page.locator('.crm-event', { hasText: 'E2E gặp khách hàng' }).first().click();
  await modal().getByText('Liên hệ:').waitFor();
  await shot('07-calendar-week-detail');
  await modal().getByRole('button', { name: 'Mở lịch hẹn trong hồ sơ khách hàng' }).click();
  await page.locator('.crm-profile-title').filter({ hasText: '000001' }).waitFor();
  expect(await tabSelected('Lịch hẹn'), 'profile did not open on the Lịch hẹn tab');
  await page.locator('.crm-tabbody').getByText('E2E gặp khách hàng').waitFor();
});

await step('08 Lịch tạo ở màn Lịch hẹn (gắn khách hàng) hiện trong tab hồ sơ; giờ kết thúc sai bị chặn; hủy có lý do', async () => {
  await nav('Lịch hẹn');
  await page.getByRole('button', { name: '+ Lịch hẹn' }).click();
  await modal().getByLabel('Tiêu đề').fill('E2E lịch từ màn Lịch');
  await selectByText(field('Khách hàng'), /000004/);
  const start = await modal().getByLabel('Bắt đầu').inputValue();
  await modal().getByLabel('Kết thúc').fill(start);
  await modal().getByRole('button', { name: 'Lưu lịch hẹn' }).click();
  await toast('Giờ kết thúc phải sau giờ bắt đầu');
  const end = new Date(new Date(start).getTime() + 3_600_000);
  const pad = (n) => String(n).padStart(2, '0');
  await modal().getByLabel('Kết thúc').fill(`${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`);
  await modal().getByRole('button', { name: 'Lưu lịch hẹn' }).click();
  await toast('Đã tạo lịch hẹn');
  await openCustomer('000004');
  await page.getByRole('tab', { name: 'Lịch hẹn', exact: true }).click();
  await page.locator('.crm-tabbody').getByText('E2E lịch từ màn Lịch').waitFor();
  await nav('Lịch hẹn');
  await page.locator('.crm-event', { hasText: 'E2E gặp khách hàng' }).first().click();
  await modal().getByRole('button', { name: 'Hủy lịch' }).click();
  expect(await modal().getByRole('button', { name: 'Hủy lịch hẹn' }).isDisabled(), 'cancel allowed without reason');
  await modal().getByRole('textbox').fill('Khách đổi lịch');
  await modal().getByRole('button', { name: 'Hủy lịch hẹn' }).click();
  await toast('Đã hủy lịch hẹn');
});

await step('09 Công việc: tạo, hoàn thành, lọc DONE (độc lập với Lịch hẹn)', async () => {
  await nav('Công việc');
  await page.getByRole('button', { name: '+ Công việc' }).click();
  await modal().getByLabel('Tên công việc').fill('E2E gửi hồ sơ năng lực');
  await modal().getByLabel('Khách hàng').selectOption({ index: 1 });
  await modal().getByRole('button', { name: 'Lưu công việc' }).click();
  await toast('Đã tạo công việc');
  await page.locator('.crm-table tbody tr', { hasText: 'E2E gửi hồ sơ năng lực' }).getByRole('button', { name: 'Hoàn thành' }).click();
  await toast('Đã hoàn thành công việc');
  await page.getByLabel('Trạng thái', { exact: true }).selectOption('DONE');
  await page.locator('.crm-table tbody tr', { hasText: 'E2E gửi hồ sơ năng lực' }).waitFor();
  await shot('09-tasks');
});

await step('10 Báo cáo: viết, nộp; lọc theo khách hàng; báo cáo hiện trong lịch sử khách hàng', async () => {
  await nav('Báo cáo');
  await page.getByRole('button', { name: '+ Viết báo cáo' }).click();
  await modal().getByLabel('Nội dung đã thực hiện').fill('E2E: gặp 2 khách hàng, gửi báo giá.');
  await modal().getByLabel('Kết quả thực hiện').fill('1 khách hẹn demo.');
  await modal().getByRole('button', { name: 'Nộp báo cáo' }).click();
  await toast('Đã nộp báo cáo');
  await page.locator('.crm-table tbody tr', { hasText: 'E2E: gặp 2 khách hàng' }).getByText('Đã nộp').waitFor();
  await selectByText(page.getByLabel('Khách hàng liên quan'), /000010/);
  await page.locator('.crm-table tbody tr', { hasText: 'Gặp ký phụ lục' }).waitFor();
  expect(await page.locator('.crm-table tbody tr', { hasText: 'E2E: gặp 2 khách hàng' }).count() === 0, 'customer filter not applied');
  await shot('10-reports-filtered');
  await openCustomer('000010');
  await page.getByRole('tab', { name: 'Hoạt động & Kết quả', exact: true }).click();
  await page.locator('.crm-tabbody').getByText('Báo cáo công việc liên quan').waitFor();
  await page.locator('.crm-tabbody').getByText('Gặp ký phụ lục').first().waitFor();
});

await step('11 Tạo KH (Sale A): 4 nhóm, kiểm tra định danh sai/trùng, xác nhận đổi nước ngoài, FE-G01 ghi rõ, Lưu Draft', async () => {
  await nav('Khách hàng');
  await page.getByRole('button', { name: '+ Khách hàng' }).click();
  for (const g of ['1. Hồ sơ', '2. Địa chỉ đăng ký', '3. Người liên hệ', '4. Sale phụ trách và nhóm ngành']) await modal().locator('legend', { hasText: g }).waitFor();
  await modal().getByText('FE-G01, chưa được duyệt').waitFor();
  expect(await modal().getByLabel('Sale chính').count() === 0, 'sale without assignment.manage can pick the primary sale');
  expect(await modal().getByRole('button', { name: 'Lưu và xác minh' }).count() === 0, 'verify offered without permission');
  await modal().getByLabel('Tên thường gọi').fill('E2E Khách hàng mới');
  await modal().getByLabel('Số định danh').fill('123');
  await modal().locator('.crm-check-err', { hasText: 'Sai cấu trúc' }).waitFor();
  await modal().getByLabel('Số định danh').fill('0100000001');
  await modal().locator('.crm-check-err', { hasText: 'Định danh đã tồn tại' }).waitFor();
  await modal().getByRole('button', { name: 'Mở hồ sơ đã có' }).waitFor();
  await modal().getByLabel('Số định danh').fill('');
  await modal().getByLabel('Số nhà, tên đường').fill('Số 1 E2E');
  await page.getByText('Khách hàng nước ngoài (địa chỉ ngoài Việt Nam)').click();
  await modal().getByText('sẽ xóa địa chỉ đang nhập').waitFor();
  await modal().getByRole('button', { name: 'Giữ nguyên' }).click();
  await page.getByRole('button', { name: '+ Thêm người liên hệ' }).click();
  await page.getByLabel('Họ tên liên hệ 1').fill('Chị E2E');
  await page.getByLabel('Điện thoại liên hệ 1').fill('0900000099');
  await shot('11-create-form-sale');
  await page.getByRole('button', { name: 'Lưu Draft' }).click();
  await toast('Đã lưu hồ sơ khách hàng (DRAFT)');
  await page.locator('.crm-profile-title').filter({ hasText: 'E2E Khách hàng mới' }).waitFor();
  await page.locator('.crm-profile-left').getByText('DRAFT').first().waitFor();
  await page.getByRole('tab', { name: 'Thông tin liên hệ', exact: true }).click();
  await page.locator('.crm-tabbody').getByText('Chị E2E').waitFor();
});

await step('12 Tạo KH (Quản lý): chọn Sale chính/hỗ trợ, nhóm ngành, Lưu và xác minh → VERIFIED', async () => {
  await persona(P.MGR);
  await nav('Khách hàng');
  await page.getByRole('button', { name: '+ Khách hàng' }).click();
  await modal().getByLabel('Tên thường gọi').fill('E2E KH quản lý tạo');
  await modal().getByLabel('Tên pháp lý').fill('CÔNG TY MẪU E2E QUẢN LÝ');
  await modal().getByLabel('Số định danh').fill('0107777777');
  await modal().locator('.crm-check-ok').waitFor();
  await modal().getByLabel('Số nhà, tên đường').fill('Số 7 đường E2E');
  await modal().getByLabel('Tỉnh / Thành phố').selectOption('01');
  await modal().getByLabel('Phường / Xã / Đặc khu').selectOption('00004');
  await modal().getByLabel('Sale chính').selectOption({ label: 'Trần Thị Bình' });
  await modal().locator('.crm-checklist label', { hasText: 'Lê Minh Cường' }).locator('input').check();
  await modal().locator('.crm-checklist label', { hasText: 'Dược phẩm' }).locator('input').check();
  await shot('12-create-form-manager');
  await modal().getByRole('button', { name: 'Lưu và xác minh' }).click();
  await toast('Đã tạo và xác minh hồ sơ khách hàng (VERIFIED)');
  await page.locator('.crm-profile-left').getByText('Đã xác minh').first().waitFor();
  await page.locator('.crm-profile-left').getByText('Trần Thị Bình').first().waitFor();
});

await step('13 Xác minh hồ sơ DRAFT có sẵn (Quản lý) → VERIFIED', async () => {
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill('E2E Khách hàng mới');
  await page.locator('.crm-table tbody tr', { hasText: 'E2E Khách hàng mới' }).getByRole('button', { name: 'Xem hồ sơ' }).click();
  await page.getByRole('button', { name: 'Xác minh hồ sơ' }).click();
  await modal().getByLabel('Tên pháp lý').fill('CÔNG TY MẪU E2E MỚI');
  await modal().getByLabel('Số định danh').fill('0108888888');
  await modal().getByLabel('Tỉnh / Thành phố').selectOption('01');
  await modal().getByLabel('Phường / Xã / Đặc khu').selectOption('00004');
  await modal().getByRole('button', { name: 'Xác minh', exact: true }).click();
  await toast('Hồ sơ đã được xác minh');
  await page.locator('.crm-profile-left').getByText('Đã xác minh').first().waitFor();
});

await step('13b Xem nhanh → Ẩn hồ sơ (Quản lý, REV01 §A): ẩn mềm, chỉ hiện lại khi bật "Gồm hồ sơ đã ẩn"', async () => {
  await persona(P.MGR);
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill('000020');
  await rowByCode('000020').locator('.crm-name-link').click();
  await modal().getByRole('button', { name: 'Ẩn hồ sơ' }).click();
  await modal().getByRole('button', { name: 'Ẩn hồ sơ' }).click(); // confirm dialog
  await toast('Đã ẩn hồ sơ');
  await page.getByText('Không có khách hàng nào trong phạm vi').waitFor();
  await page.getByText('Gồm hồ sơ đã ẩn').click();
  await rowByCode('000020').getByText('Đã ẩn').waitFor();
  await page.getByText('Gồm hồ sơ đã ẩn').click();
});

await step('14 FE-FIX-02 luồng B: Sale A có To-do mở cho KH 000007 → Quản lý duyệt → Sale C nhận; To-do chuyển (Target Design)', async () => {
  await persona(P.A);
  await openCustomer('000007');
  await page.getByRole('tab', { name: 'Công việc', exact: true }).click();
  await page.locator('.crm-tabbody').getByText('Chuẩn bị bảng giá cho khách 000007').waitFor();
  await persona(P.MGR);
  await nav('Tổng quan công việc');
  await page.locator('.crm-row-btn', { hasText: 'Chờ quản lý duyệt' }).first().click();
  await page.locator('#title').filter({ hasText: 'KHÁCH HÀNG' }).waitFor(); // processed in the customer context, not on the dashboard
  await modal().getByRole('button', { name: 'Duyệt bàn giao' }).click();
  await toast('Đã duyệt bàn giao');
  await modal().getByText('Target Design').first().waitFor(); // preview of what will move
  await modal().getByRole('button', { name: 'Đóng' }).last().click();
  await persona(P.C);
  await nav('Tổng quan công việc');
  await page.locator('.crm-row-btn', { hasText: 'Chờ Sale nhận xác nhận' }).first().click();
  await page.locator('#title').filter({ hasText: 'KHÁCH HÀNG' }).waitFor();
  await modal().getByRole('button', { name: 'Nhận bàn giao' }).click();
  await toast('Đã nhận bàn giao');
  await modal().locator('.crm-badge', { hasText: 'Hoàn tất' }).first().waitFor();
  await modal().getByText('Diễn biến bàn giao').waitFor();
  await modal().getByRole('button', { name: 'Mở hồ sơ khách hàng' }).click();
  await page.locator('.crm-profile-left').getByText('Lê Minh Cường').first().waitFor();
  await page.getByText(/To-do \(\s*Target Design\s*\)/).first().waitFor();
  await page.getByRole('tab', { name: 'Công việc', exact: true }).click();
  await page.locator('.crm-tabbody tr', { hasText: 'Chuẩn bị bảng giá cho khách 000007' }).getByText('Đã chuyển giao').waitFor();
  await nav('Công việc');
  await page.locator('.crm-table tbody tr', { hasText: 'Chuẩn bị bảng giá cho khách 000007' }).waitFor();
  await shot('14-handover-todo-transferred');
  await persona(P.A);
  await page.goto(`${base}/crm/customers?customer=cus-007`);
  await page.locator('.crm-guard', { hasText: 'Không tìm thấy hồ sơ' }).waitFor(); // previous sale lost scope
});

await step('15 Luồng A: Quản lý yêu cầu; xác nhận thay chỉ khi Sale hiện tại đã nghỉ (KH 000012); Sale B nhận', async () => {
  await persona(P.MGR);
  await openCustomer('000012');
  await page.getByRole('button', { name: 'Yêu cầu bàn giao' }).click();
  await field('Luồng').selectOption('MANAGER_INITIATED');
  await field('Sale nhận').selectOption({ label: 'Trần Thị Bình' });
  await modal().getByRole('button', { name: 'Gửi yêu cầu' }).click();
  await toast('Đã tạo yêu cầu bàn giao');
  await page.getByRole('button', { name: 'Xác nhận thay (Sale đã nghỉ)' }).click();
  await modal().getByRole('textbox').fill('Sale cũ đã nghỉ việc (E2E)');
  await modal().getByRole('button', { name: 'Xác nhận thay' }).click();
  await toast('Đã xác nhận thay');
  await page.getByText('Chờ Sale nhận xác nhận').first().waitFor();
  // a customer whose current sale is active: request flow A, override must NOT be offered
  await openCustomer('000003');
  await page.getByRole('button', { name: 'Yêu cầu bàn giao' }).click();
  await field('Luồng').selectOption('MANAGER_INITIATED');
  await field('Sale nhận').selectOption({ label: 'Trần Thị Bình' });
  await modal().getByRole('button', { name: 'Gửi yêu cầu' }).click();
  await toast('Đã tạo yêu cầu bàn giao');
  await page.getByText('Chờ Sale hiện tại xác nhận').first().waitFor();
  expect(await page.getByRole('button', { name: 'Xác nhận thay (Sale đã nghỉ)' }).count() === 0, 'override offered while current sale is active');
  await persona(P.B);
  await nav('Khách hàng'); // queue opened from the Khách hàng toolbar
  await page.getByRole('button', { name: /^Chờ xử lý \(\d+\)$/ }).click();
  await modal().locator('.crm-row-btn', { hasText: 'Chờ Sale nhận xác nhận' }).first().click();
  await modal().getByRole('button', { name: 'Nhận bàn giao' }).click();
  await toast('Đã nhận bàn giao');
  await modal().locator('.crm-badge', { hasText: 'Hoàn tất' }).first().waitFor();
  await modal().getByText('Diễn biến bàn giao').waitFor();
  await shot('15-handover-flow-a');
  await modal().getByRole('button', { name: 'Đóng' }).last().click();
  // closing the item returns to the queue list (opened from the toolbar); close it too
  await page.getByRole('dialog', { name: 'Bàn giao và duyệt pháp lý chờ xử lý' }).waitFor();
  await modal().getByRole('button', { name: 'Đóng' }).last().click();
  expect(await page.locator('.crm-overlay').count() === 0, 'a dialog is still open');
});

await step('15b Bàn giao đã kết thúc: danh sách trong màn Khách hàng, diễn biến từng bước, việc đã chuyển', async () => {
  await persona(P.MGR);
  await nav('Khách hàng');
  await page.getByRole('button', { name: /^Chờ xử lý \(\d+\)$/ }).click();
  await modal().getByRole('button', { name: /^Bàn giao đã kết thúc \(\d+\)$/ }).click();
  const rows = modal().locator('.crm-row-btn', { hasText: 'Hoàn tất' });
  expect(await rows.count() >= 2, 'expected the two handovers completed in steps 14–15');
  await modal().locator('.crm-row-btn', { hasText: 'Trần Thị Bình' }).filter({ hasText: 'Hoàn tất' }).first().click();
  await modal().getByText('Diễn biến bàn giao').waitFor();
  await modal().getByText('Xác nhận thay (đề xuất D05)').waitFor(); // flow A with override (step 15)
  await modal().getByText('Sale cũ đã nghỉ việc (E2E)', { exact: false }).waitFor();
  await modal().getByText('Việc đã chuyển').waitFor();
  await shot('15b-handover-finished');
  await modal().getByRole('button', { name: 'Đóng' }).last().click();
  await modal().getByRole('button', { name: /^Bàn giao đã kết thúc/ }).click();
  await modal().locator('.crm-row-btn', { hasText: 'Lê Minh Cường' }).filter({ hasText: 'Hoàn tất' }).first().click(); // FE-FIX-02 (step 14)
  await modal().getByText('To-do: Chuẩn bị bảng giá cho khách 000007').waitFor();
  await modal().getByRole('button', { name: 'Đóng' }).last().click();
  await modal().getByRole('button', { name: 'Đóng' }).last().click();
  expect(await page.locator('.crm-overlay').count() === 0, 'a dialog is still open');
});

await step('16 Thay đổi pháp lý 2 cấp: quản lý rồi kế toán; người đề nghị không tự duyệt', async () => {
  await persona(P.B);
  await openCustomer('000002');
  expect(await page.getByRole('button', { name: 'Duyệt (quản lý)' }).count() === 0, 'requester/sale can approve');
  await persona(P.MGR);
  await openCustomer('000002');
  await page.getByRole('button', { name: 'Duyệt (quản lý)' }).click();
  await toast('Đã duyệt cấp quản lý');
  await page.locator('.crm-profile-head .crm-sub').filter({ hasText: /^Công ty CP Thử Nghiệm Bình Minh$/ }).waitFor(); // legal name unchanged before accounting
  await page.getByText('Chờ kế toán duyệt').first().waitFor();
  await persona(P.ACC);
  await openCustomer('000002');
  await page.getByRole('button', { name: 'Duyệt (kế toán)' }).click();
  await toast('Đã duyệt cấp kế toán');
  await page.locator('.crm-profile-head .crm-sub').filter({ hasText: /^Công ty CP Thử Nghiệm Bình Minh Mới$/ }).waitFor();
  await page.locator('.crm-card', { hasText: 'Lịch sử thay đổi pháp lý' }).getByText('Đã áp dụng').waitFor(); // before → after kept as history
  await shot('16-legal-applied');
});

await step('16b Audit Demo: ghi actor + mã hành động cho các thao tác vừa làm, không chứa PII, nhãn không phải audit Foundation', async () => {
  await page.getByRole('button', { name: 'Nhật ký thao tác (Audit demo)' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nhật ký thao tác (Audit demo)' });
  await dlg.getByText('Không phải Audit của Foundation').waitFor();
  const actions = await dlg.locator('tbody tr td:nth-child(3)').allTextContents();
  for (const a of ['CRM.LEGAL_CHANGE.APPROVE_ACCOUNTING', 'CRM.LEGAL_CHANGE.APPROVE_MANAGEMENT', 'CRM.HANDOVER.OVERRIDE', 'CRM.HANDOVER.ACKNOWLEDGE', 'CRM.CUSTOMER.VERIFY', 'CRM.CUSTOMER.CREATE'])
    expect(actions.includes(a), `audit missing ${a}`);
  expect((await dlg.locator('tbody tr').first().locator('td').nth(1).textContent()) === 'Hoàng Thu Hà', 'latest entry actor is not the accountant');
  const text = await dlg.textContent();
  expect(!text.includes('0108888888') && !text.includes('Bình Minh Mới'), 'audit shows PII / identifiers');
  await shot('16b-audit-demo');
  await dlg.getByRole('button', { name: 'Đóng' }).click();
});

await step('17 Phạm vi Sale A: không thấy KH ngoài phạm vi (tìm kiếm, deep link), không có Xuất CSV', async () => {
  await persona(P.A);
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill('000003');
  await page.getByText('Không có khách hàng nào trong phạm vi').waitFor();
  await page.getByLabel('Tìm khách hàng').fill('0100000001'); // own customer 000001, full right → found
  await rowByCode('000001').waitFor();
  await page.getByLabel('Tìm khách hàng').fill('0100000008'); // identifier of VERIFIED 000008 (outside Sale A scope) → nothing disclosed
  await page.getByText('Không có khách hàng nào trong phạm vi').waitFor();
  expect(await page.getByRole('button', { name: 'Xuất CSV' }).count() === 0, 'export visible without permission');
  await page.goto(`${base}/crm/customers?customer=cus-003`);
  await page.locator('.crm-guard', { hasText: 'Không tìm thấy hồ sơ' }).waitFor();
});

await step('18 Persona chỉ xem: 2 KH được hỗ trợ, định danh bị che, không có nút tạo/sửa/xuất', async () => {
  await page.goto(`${base}/crm/customers`);
  await persona(P.VIEW);
  await nav('Khách hàng');
  await page.waitForTimeout(150);
  const codes = await page.locator('.crm-table tbody tr td:first-child').allTextContents();
  expect(JSON.stringify(codes) === JSON.stringify(['000001', '000004']), `viewer scope: ${codes.join(',')}`);
  const ids = await page.locator('.crm-table tbody tr td:nth-child(4)').allTextContents();
  expect(ids.every((t) => t === '—' || t.includes('•')), `identifier not masked: ${ids.join('|')}`);
  for (const b of ['+ Khách hàng', 'Xuất CSV']) expect(await page.getByRole('button', { name: b }).count() === 0, `${b} visible`);
  // no right to view the full identifier → identifier is not a search field (exact or partial)
  expect(!(await page.getByLabel('Tìm khách hàng').getAttribute('placeholder')).includes('MST'), 'placeholder offers MST search');
  await page.getByLabel('Tìm khách hàng').fill('0100000001');
  await page.getByText('Không có khách hàng nào trong phạm vi').waitFor();
  await page.getByLabel('Tìm khách hàng').fill('00000001'); // partial of 000001's identifier (in scope)
  await page.getByText('Không có khách hàng nào trong phạm vi').waitFor();
  await page.getByLabel('Tìm khách hàng').fill('000001');
  await rowByCode('000001').waitFor();
  await shot('18-viewer-search-masked');
  await rowByCode('000001').getByRole('button', { name: 'Xem hồ sơ' }).click();
  await page.locator('.crm-profile-title').waitFor();
  expect(await page.getByRole('button', { name: 'Sửa thông tin' }).count() === 0, 'edit visible for viewer');
  await page.locator('.crm-profile-left').getByText('Đã che theo quyền').first().waitFor();
  await shot('18-viewer-profile');
});

await step('19 Tài liệu: phiên bản thay thế, nhãn BLOCKED và D06/D07, không có tải xuống giả', async () => {
  await persona(P.A);
  await openCustomer('000001');
  await page.getByRole('tab', { name: 'Tài liệu', exact: true }).click();
  await page.locator('.crm-tabbody').getByText('BLOCKED — chưa có storage được phê duyệt').waitFor();
  await page.locator('.crm-tabbody').getByText('cấu hình đề xuất D06').waitFor();
  await page.locator('.crm-tabbody').getByText(/Thay cho:/).first().waitFor();
  expect(await page.getByRole('button', { name: /Tải xuống/ }).count() === 0, 'fake download button');
  await shot('19-documents');
});

await step('19b Lập báo cáo từ To-do và từ lịch hẹn: form mở sẵn liên kết (Calendar / To-do / Report độc lập nhưng liên kết)', async () => {
  await page.goto(`${base}/crm`);
  await persona(P.A);
  await nav('Công việc');
  await page.locator('.crm-table tbody tr', { hasText: 'Gửi báo giá thùng carton 3 lớp' }).getByRole('button', { name: 'Lập báo cáo' }).click();
  await page.locator('#title').filter({ hasText: 'BÁO CÁO' }).waitFor();
  expect(await field('Nội dung đã thực hiện').inputValue() === 'Gửi báo giá thùng carton 3 lớp', 'report not seeded from task');
  expect(await modal().locator('fieldset', { hasText: 'Liên kết công việc' }).locator('label', { hasText: 'Gửi báo giá thùng carton 3 lớp' }).locator('input').isChecked(), 'task link not pre-checked');
  await modal().locator('.crm-chip', { hasText: '000001' }).waitFor();
  await field('Kết quả thực hiện').fill('Đã gửi báo giá (E2E).');
  await modal().getByRole('button', { name: 'Nộp báo cáo' }).click();
  await toast('Đã nộp báo cáo');
  await page.locator('.crm-table tbody tr', { hasText: 'Gửi báo giá thùng carton 3 lớp' }).getByText('Đã nộp').waitFor();
  await nav('Lịch hẹn');
  await page.getByRole('group', { name: 'Chế độ xem' }).getByRole('button', { name: 'Tuần' }).click();
  await page.locator('.crm-event', { hasText: 'Gặp trao đổi báo giá Q4' }).first().click();
  await modal().getByRole('button', { name: 'Lập báo cáo' }).click();
  await page.locator('#title').filter({ hasText: 'BÁO CÁO' }).waitFor();
  expect(await modal().locator('fieldset', { hasText: 'Liên kết lịch hẹn' }).locator('label', { hasText: 'Gặp trao đổi báo giá Q4' }).locator('input').isChecked(), 'appointment link not pre-checked');
  await field('Kết quả thực hiện').fill('Khách đồng ý xem mẫu (E2E).');
  await modal().getByRole('button', { name: 'Lưu nháp' }).click();
  await toast('Đã lưu bản nháp');
  await page.locator('.crm-table tbody tr', { hasText: 'Gặp trao đổi báo giá Q4' }).getByText('Bản nháp').waitFor();
  await shot('19b-report-from-origin');
});

await step('21 UI-02 Sidebar thu gọn: thu gọn → điều hướng → mở rộng, giữ trạng thái màn hình, không vỡ bố cục', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/crm`);
  await persona(P.MGR);
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill('Mẫu');
  await page.getByLabel('Miền', { exact: true }).selectOption('SOUTH');
  await page.waitForTimeout(450);
  const rowsBefore = await page.locator('.crm-table tbody tr td:first-child').allTextContents();
  expect(rowsBefore.length > 0, 'no rows before compact');
  const wide = (await page.locator('aside.sidebar').boundingBox()).width;
  await page.locator('#collapse-button').click();
  await page.locator('.app-shell.sidebar-compact .layout.compact').waitFor();
  const narrowW = (await page.locator('aside.sidebar').boundingBox()).width;
  expect(wide > 200 && narrowW < 80, `sidebar width ${wide} → ${narrowW}`);
  expect(!(await page.locator('aside.sidebar .nav-label').first().isVisible()), 'labels still visible in compact');
  expect(await page.locator('aside.sidebar .nav-abbr').first().isVisible(), 'abbreviations not shown in compact');
  expect(await page.getByLabel('Tìm khách hàng').inputValue() === 'Mẫu', 'search lost after compact');
  expect(await page.getByLabel('Miền', { exact: true }).inputValue() === 'SOUTH', 'filter lost after compact');
  const rowsAfter = await page.locator('.crm-table tbody tr td:first-child').allTextContents();
  expect(JSON.stringify(rowsAfter) === JSON.stringify(rowsBefore), 'rows changed after compact');
  const side = await page.locator('aside.sidebar').boundingBox();
  const main = await page.locator('main.workspace').boundingBox();
  expect(main.x >= side.x + side.width - 1, 'workspace overlaps sidebar');
  await noPageOverflow('compact');
  await notCovered(page.getByRole('button', { name: '+ Khách hàng' }), '+ Khách hàng (compact)');
  await shot('21-ui02-compact');
  await nav('Lịch hẹn'); // compact entry: accessible name comes from its title
  expect(await page.locator('.app-shell.sidebar-compact').count() === 1, 'compact lost on navigation');
  await nav('Khách hàng');
  await page.locator('#collapse-button').click();
  await page.waitForFunction(() => (document.querySelector('aside.sidebar')?.getBoundingClientRect().width ?? 0) > 200);
  expect(await page.locator('.app-shell.sidebar-compact').count() === 0, 'still compact');
  expect(await page.locator('aside.sidebar .nav-label').first().isVisible(), 'labels hidden after expand');
  await nav('Công việc');
  await noPageOverflow('expanded');
  await shot('21-ui02-expanded');
});

await step('22 UI-18 Khôi phục dữ liệu mẫu: hủy xác nhận không đổi gì; đồng ý → về seed, xóa thay đổi mock, màn đang mở cập nhật', async () => {
  await page.goto(`${base}/crm`);
  await persona(P.A);
  await nav('Công việc');
  await page.getByRole('button', { name: '+ Công việc' }).click();
  await field('Tên công việc').fill('E2E dữ liệu sẽ bị xóa khi khôi phục');
  await modal().getByRole('button', { name: 'Lưu công việc' }).click();
  await toast('Đã tạo công việc');
  const marker = page.locator('.crm-table tbody tr', { hasText: 'E2E dữ liệu sẽ bị xóa khi khôi phục' });
  await marker.waitFor();
  expect(await page.evaluate(() => (localStorage.getItem('talo-crm-mock-state') ?? '').includes('E2E')), 'mock changes not persisted before reset');
  const messages = [];
  page.once('dialog', (d) => { messages.push(d.message()); void d.dismiss(); });
  await page.getByRole('button', { name: 'Khôi phục dữ liệu mẫu' }).click();
  await page.waitForTimeout(300);
  expect(messages.length === 1 && messages[0].includes('Khôi phục toàn bộ dữ liệu mẫu'), `confirm not shown: ${messages.join('|')}`);
  expect(await marker.count() === 1, 'data changed although the user cancelled');
  page.once('dialog', (d) => { messages.push(d.message()); void d.accept(); });
  await page.getByRole('button', { name: 'Khôi phục dữ liệu mẫu' }).click();
  await marker.waitFor({ state: 'detached' }); // the open screen refreshes without a page reload
  await page.locator('.crm-table tbody tr', { hasText: 'Gửi báo giá thùng carton 3 lớp' }).waitFor();
  expect(messages.length === 2, 'second confirm missing');
  expect(!(await page.evaluate(() => (localStorage.getItem('talo-crm-mock-state') ?? '').includes('E2E'))), 'E2E changes still stored after reset');
  await persona(P.MGR);
  await openCustomer('000002');
  await page.locator('.crm-profile-head .crm-sub').filter({ hasText: /^Công ty CP Thử Nghiệm Bình Minh$/ }).waitFor(); // legal change of step 16 rolled back
  await page.getByText('Chờ quản lý duyệt').first().waitFor(); // seed legal request pending again
  await nav('Khách hàng');
  await page.getByLabel('Tìm khách hàng').fill('E2E');
  await page.getByText('Không có khách hàng nào trong phạm vi').waitFor(); // customers created in steps 11–12 removed
  await page.getByRole('button', { name: 'Nhật ký thao tác (Audit demo)' }).click();
  await page.getByRole('dialog', { name: 'Nhật ký thao tác (Audit demo)' }).getByText('Chưa có thao tác nào').waitFor(); // audit demo cleared too
  await page.getByRole('dialog', { name: 'Nhật ký thao tác (Audit demo)' }).getByRole('button', { name: 'Đóng' }).click();
  await shot('22-ui18-after-reset');
});

// --------------------------------------------------------------------------------------------- responsive (FE-FIX-01)
for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
  await step(`20-${w} Responsive ${w}px: điều hướng 5 màn, nút không bị che, bảng/popup dùng được, hồ sơ`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${base}/crm`);
    await persona(P.MGR);
    if (w <= 760) {
      expect(!(await page.locator('aside.sidebar').isVisible()) || (await page.locator('aside.sidebar').boundingBox()).x < -100, 'sidebar not hidden on mobile');
      await page.locator('.mobile-bottom-nav').waitFor();
    } else expect(await page.locator('.mobile-bottom-nav').isVisible() === false, 'bottom nav visible on desktop');
    for (const s of SCREENS) { await nav(s); await noPageOverflow(s); }
    await nav('Khách hàng');
    await page.locator('.crm-table tbody tr').first().waitFor();
    await notCovered(page.getByRole('button', { name: '+ Khách hàng' }), '+ Khách hàng');
    await shot(`20-${w}-customers`);
    await page.getByRole('button', { name: '+ Khách hàng' }).click();
    await notCovered(modal().getByRole('button', { name: 'Lưu Draft' }), 'Lưu Draft');
    await notCovered(modal().getByRole('button', { name: 'Hủy bỏ' }), 'Hủy bỏ');
    await shot(`20-${w}-create-form`);
    await modal().getByRole('button', { name: 'Hủy bỏ' }).click();
    await rowByCode('000001').getByRole('button', { name: 'Xem hồ sơ' }).click();
    await page.locator('.crm-profile-title').waitFor();
    for (const t of TABS) { await page.getByRole('tab', { name: t, exact: true }).click(); expect(await tabSelected(t), `tab ${t}`); }
    await page.getByRole('tab', { name: 'Tổng quan', exact: true }).click();
    await noPageOverflow('profile');
    await notCovered(page.getByRole('button', { name: '+ Công việc' }), 'profile + Công việc');
    await shot(`20-${w}-profile`);
    await nav('Lịch hẹn');
    await notCovered(page.getByRole('button', { name: '+ Lịch hẹn' }), 'calendar + Lịch hẹn');
    await shot(`20-${w}-calendar`);
    if (w <= 760) {
      await openDrawer();
      await page.locator('.app-shell.mobile-open .mobile-overlay').click({ position: { x: w - 20, y: 200 } });
      expect(await page.locator('.app-shell.mobile-open').count() === 0, 'overlay did not close the drawer');
      await openDrawer();
      await shot(`20-${w}-drawer-open`);
      await page.locator('#mobileBottomMenu').click(); // toggle closed
      await page.locator('#mobileBottomHome').click();
      await page.locator('#title').filter({ hasText: 'TỔNG QUAN CÔNG VIỆC' }).waitFor();
    }
  });
}

await browser.close();
const result = { base, ranAt: new Date().toISOString(), steps, consoleErrors: errors,
  summary: { pass: steps.filter((s) => s.result === 'PASS').length, fail: steps.filter((s) => s.result === 'FAIL').length, consoleErrors: errors.length } };
writeFileSync(resolve(out, 'e2e-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary));
process.exitCode = result.summary.fail === 0 && errors.length === 0 ? 0 : 1;
