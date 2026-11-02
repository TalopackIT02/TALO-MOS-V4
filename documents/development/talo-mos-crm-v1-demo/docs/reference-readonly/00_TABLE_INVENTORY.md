# Danh mục bảng dữ liệu — baseline và target

| Bảng (`cm`) | Tên tiếng Việt | R2 đã cài (theo báo cáo) | Cột bổ sung (chưa cài) | Tổng target |
|---|---|---:|---:|---:|
| `cm_customers` | Hồ sơ và pháp lý khách hàng | 23 | 1 | 24 |
| `cm_customer_contacts` | Người liên hệ | 12 | 0 | 12 |
| `cm_customer_groups` | Nhóm/ngành khách hàng | 8 | 0 | 8 |
| `cm_customer_group_members` | Gán khách hàng vào nhiều nhóm | 4 | 0 | 4 |
| `cm_customer_assignments` | Phân công Sale và lịch sử | 11 | 1 | 12 |
| `cm_customer_activities` | Nhật ký và công việc | 12 | 0 | 12 |
| `cm_customer_documents` | Tài liệu, hiệu lực, phiên bản | 14 | 1 | 15 |
| `cm_ref_provinces` | Danh mục 34 tỉnh/thành | 8 | 0 | 8 |
| `cm_ref_wards` | Danh mục 3.321 xã/phường/đặc khu | 9 | 0 | 9 |
| `cm_ref_economic_regions` | Danh mục 6 vùng kinh tế | 6 | 0 | 6 |
| `cm_ref_province_region_map` | Ánh xạ tỉnh–vùng/3 miền | 7 | 0 | 7 |
| `cm_customer_legal_change_requests` | Yêu cầu sửa pháp lý (candidate) | 0 | 20 | 20 |
| `cm_customer_legal_change_approvals` | Duyệt sửa pháp lý (candidate) | 0 | 7 | 7 |
| `cm_customer_handovers` | Bàn giao nhiều bước (candidate) | 0 | 21 | 21 |
| `cm_customer_handover_activity_transfers` | Lịch sử chuyển việc (candidate) | 0 | 8 | 8 |
| **Tổng** | | **114 / 11 bảng** | **59 (3 + 56) / 4 bảng mới** | **173 / 15 bảng** |

**QUAN TRỌNG:** 15 bảng / 173 cột chỉ là trạng thái **dự kiến nếu migration BE REV01 được duyệt/cài**. Hiện trạng TEST được báo cáo đã cài là 11 bảng / 114 cột.

Nguồn chi tiết: `01_ALL_COLUMNS_173.csv`, `01_ALL_COLUMNS_173.json`, `02_DATA_DICTIONARY_FULL.md`, SQL R2 reference, SQL Migration Candidate.
