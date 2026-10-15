import type { ReactNode } from 'react';
import type { ScreenId } from '../../routes/shellScreens';

// Block 4 of the F1 screens. No registry, account or role API exists yet (BLOCKED), so the screens only describe their
// structure (texts of the approved HTML) and show "no data" — never sample rows presented as backend data, never a
// form that looks functional.

const NOTE = 'Màn hình chưa kết nối API. Nội dung chỉ mô tả cấu trúc, không đại diện cho chức năng hoặc dữ liệu đã hoàn thành trong ứng dụng.';

function Table({ cols, rows }: { cols: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className="tablewrap">
      <table>
        <thead><tr>{cols.map((col) => <th key={col}>{col}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Described({ info, children }: { info?: string; children: ReactNode }) {
  return (
    <>
      {info && <p className="info">{info}</p>}
      {children}
      <div className="note">{NOTE}</div>
    </>
  );
}

export function ScreenBody({ screen, tab }: { screen: ScreenId; tab: number }) {
  switch (screen) {
    case 'home':
      return (
        <>
          <p className="info">Các màn hình nằm trong phạm vi triển khai AppShell hiện tại. Các phân hệ nghiệp vụ chưa phát triển không được đưa vào menu.</p>
          <div className="cards">
            <div className="card"><b>Foundation</b><p>Đăng ký Module và tiếp nhận danh sách chức năng, hành động.</p></div>
            <div className="card"><b>IAM</b><p>Tài khoản, vai trò và quyền sử dụng các chức năng.</p></div>
            <div className="card"><b>AppShell</b><p>Topbar, Sidebar có menu con, Breadcrumb và khung nội dung.</p></div>
          </div>
        </>
      );
    case 'module':
      return tab === 0 ? (
        <Described info="Chưa kết nối registry module. Danh sách chưa có dữ liệu thực.">
          <Table cols={['Module', 'Chức năng', 'Trạng thái']} rows={[['Chưa có dữ liệu', '—', '—']]} />
        </Described>
      ) : (
        <Described>
          <Table cols={['Trường', 'Mô tả']} rows={[['module_key', 'Định danh module'], ['module_name', 'Tên hiển thị'], ['module_version', 'Phiên bản module'], ['contract_version', 'Phiên bản hợp đồng công bố']]} />
        </Described>
      );
    case 'capability':
      return tab === 0 ? (
        <Described info="Module công bố các Function và Action. Foundation tiếp nhận để tổ chức điều hướng; IAM dùng danh mục đã công bố để xác định quyền.">
          <Table cols={['Cấp', 'Ý nghĩa']} rows={[['Module', 'Phân hệ sở hữu'], ['Function', 'Màn hình hoặc chức năng'], ['Action', 'Hành động của chức năng']]} />
        </Described>
      ) : (
        <Described>
          <Table cols={['Trường', 'Ý nghĩa']} rows={[['module_key', 'Module sở hữu'], ['function_key', 'Chức năng'], ['action_key', 'Hành động'], ['route', 'Đường dẫn, nếu chức năng có màn hình']]} />
        </Described>
      );
    case 'accounts':
      return tab === 0 ? (
        <Described info="Chưa kết nối API quản lý tài khoản. Danh sách chưa có dữ liệu thực.">
          <Table cols={['Tài khoản', 'Trạng thái', 'Vai trò']} rows={[['Chưa có dữ liệu', '—', '—']]} />
        </Described>
      ) : (
        <Described>
          <Table cols={['Nhóm thông tin', 'Trường dự kiến']} rows={[['Định danh', 'Tên đăng nhập'], ['Tài khoản', 'Trạng thái'], ['Phân quyền', 'Vai trò được gán']]} />
        </Described>
      );
    case 'roles':
      return tab === 0 ? (
        <Described info="Danh sách vai trò sẽ được tải từ IAM khi kết nối API.">
          <Table cols={['Tên vai trò', 'Trạng thái']} rows={[['Chưa có dữ liệu', '—']]} />
        </Described>
      ) : (
        <Described info="Quyền truy cập ứng dụng được tham chiếu từ danh mục Function / Action. Màn hình này chưa ghi thay đổi quyền.">
          <Table cols={['Thành phần', 'Nội dung']} rows={[['Role', 'Vai trò được chọn'], ['Function', 'Chức năng ứng dụng'], ['Action', 'Quyền thao tác']]} />
        </Described>
      );
  }
}
