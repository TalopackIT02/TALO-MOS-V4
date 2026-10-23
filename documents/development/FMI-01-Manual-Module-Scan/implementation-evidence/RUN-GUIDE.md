# FMI-01 — Hướng dẫn sử dụng

## Quét Module

1. Chép thư mục package (do AI tạo) vào `modules/MODULE_KEY/` — tên thư mục đúng `moduleKey` (K01). Package mới cần `module.json` và `mic/module.mic.json` (MIC-01…MIC-10 dạng JSON).
2. Mở **Foundation → Quản lý Module → Module & Phiên bản**. Nút **Quét Module** (cạnh *Tải lại*) chỉ hiện khi tài khoản có cả `foundation.module_registry.read` và `foundation.module_registry.create`.
3. Bấm **Quét Module**. Kết quả: thời điểm quét, ba thanh Đỏ (FAIL) / Vàng (WARN) / Xanh (PASS) đếm theo package, số "Chưa xác minh" (UNAVAILABLE) riêng, bảng module có tìm kiếm và lọc.
4. Bấm **Chi tiết** để mở panel bên phải: tổng quan, tệp & MIC, 20 phép kiểm, vấn đề (tệp, trường, mong đợi, thực tế, cách sửa), Registry, mã băm. Đóng bằng ×, Esc hoặc bấm ra ngoài.
5. Sửa thư mục rồi bấm **Quét Module** lại. Không có quét tự động; "Xem lại kết quả lần quét trước" chỉ đọc kết quả còn lưu (10 phút) trên máy chủ.

Kết quả quét là **xem trước tĩnh**: không đăng ký, không tạo phiên bản, không cài đặt, không kích hoạt; `Đủ điều kiện Preflight` không có nghĩa là sẵn sàng kích hoạt; MIC-10 trong tệp chỉ là khai báo.

## Package candidate và runtime (khóa triển khai)

`npm run dev | build | test | typecheck` chạy `modules:sync`. Từ FMI-01, sync chỉ cài các package ghi trong **`backend/module-deployments.json`** (moduleKey + packageVersion + packageHash):

- Thư mục mới trong `modules/` không có trong khóa → bỏ qua ("candidate only"), Host không nạp.
- Thư mục đã triển khai bị ghi đè (phiên bản / nội dung khác) → sync **dừng** trước khi đụng `installed-modules`, mã đang chạy giữ nguyên; lệnh npm báo lỗi.
- Thiếu tệp khóa → dừng (fail closed).

**Sau khi một package đã được nghiệm thu** (theo quy trình FMI-02/FMI-03 hoặc quyết định của chủ dự án), người bảo trì cập nhật khóa:

```powershell
cd D:\Documents\ClaudeProject\TALO-MOS-V4\backend
node scripts/modules-sync.mjs hash SYSTEM_TEST    # chỉ đọc: in {moduleKey, packageVersion, packageHash}
```

Chép giá trị vào `backend/module-deployments.json`, rà diff và commit. Sửa mã của một module đã triển khai cũng cần cập nhật khóa (cố ý: tránh nạp mã chưa duyệt).

## Áp dụng bản cập nhật

Khởi động lại backend dev (Ctrl+C rồi `npm run dev` trong `backend`) để nạp API mới; frontend Vite tự nạp lại (hoặc chạy lại `npm run dev` trong `frontend`).
