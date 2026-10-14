# design/auth-b1 — AUTH-B1.2 (UI) và AUTH-B1.3 (câu chữ P-11)

| File | Nội dung |
|---|---|
| `AUTH-B1.2-first-change-ui.md` | Đặc tả UI màn Đổi mật khẩu lần đầu: bố cục, hành vi, trạng thái, khả năng truy cập |
| `AUTH-B1.3-messages-vi.md` | Bảng câu chữ tiếng Việt và mapping `error.code` → thông báo UI |
| `AUTH-B1-color-accessibility.md` | Phân tích tương phản WCAG AA (M-2) và đề xuất hệ màu chung Login / First Change |
| `first-change-demo.html` | Demo HTML responsive, một file, không phụ thuộc mạng |
| `screenshots/` | Ảnh chụp cho Visual UI Review (Chromium): 1440×900 và 390×844 — `default`, `too-short`, `mismatch` |

Mở demo trực tiếp từ repo (đường dẫn tương đối `../../frontend/src/assets/images/` phải còn nguyên):

```text
design/auth-b1/first-change-demo.html                       # tương tác + bảng chọn trạng thái
design/auth-b1/first-change-demo.html?state=success&demo=off # một trạng thái, không có bảng chọn
```

Đây là tài liệu thiết kế: không phải mã production, không gọi Authentication API, không thay thế React Login Phase A.
Assets được tham chiếu tại chỗ, không sao chép, không chỉnh sửa.
