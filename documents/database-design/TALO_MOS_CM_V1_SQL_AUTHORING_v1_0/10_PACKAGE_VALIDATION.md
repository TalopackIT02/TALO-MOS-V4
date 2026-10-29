# 10 — Kiểm chứng gói tài liệu

- Bảng: **7**.
- Cột (định nghĩa tường minh): **76**.
- Phân bố cột: `cm_customers`=18, `cm_customer_contacts`=12, `cm_customer_groups`=8, `cm_customer_group_members`=4, `cm_customer_assignments`=11, `cm_customer_activities`=12, `cm_customer_documents`=11.
- FK: **7** (gồm FK nhóm tự tham chiếu).
- PK: 6 khóa đơn UUID + 1 khóa kép (2 cột thành phần).
- Check thiết kế: unique key, không trùng tên cột trong mỗi bảng = PASS.
- Các code hợp đồng là giá trị app, không tạo bảng.
- DDL được đề nghị **CHƯA tạo**, không có SQL triển khai trong gói đầu vào.
- Phiên bản này chỉ cấp phép soạn nháp, **NO-RUN**.
