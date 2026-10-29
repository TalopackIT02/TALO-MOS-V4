# 00 — Ranh giới thi hành

**CHO PHÉP NGAY:** Xem source/metadata TEST ở chế độ read-only nếu có quyền; sửa, tạo **file** SQL Candidate, seed script theo nguồn chính thức, runbook, rollback, static validation, đối chiếu catalog. Kiểm thử *parse* chỉ trong môi trường clone disposable nếu chủ dự án đã cho phép riêng; mặc định KHÔNG chạy.

**KHÔNG CHO PHÉP:** Bất cứ CREATE/ALTER/INSERT/UPDATE/DELETE/GRANT/ROLE trên DB, kể cả TEST; không cài SQL, không khởi động lại, không chỉnh Foundation/IAM/SCC, không chạm DEV/PROD, không commit, push, merge, deploy.

**TRỌNG TÂM:** giải quyết yêu cầu định danh, địa chỉ, phân vùng, bàn giao, tài liệu; không tạo product/order/stock/debt, không CRM pipeline.

**SQL authoring gate:** YES (tạo file). **SQL execution gate:** NO (cần lệnh riêng).

**Conflict rule:** Nếu nguồn có mâu thuẫn, liệt kê rõ trong `OPEN_ISSUES.md` và cung cấp SQL candidate an toàn cho phần còn lại. Không tự tạo thêm bảng/cột để né vấn đề. Không quay về vòng rà soát 27 bảng.
