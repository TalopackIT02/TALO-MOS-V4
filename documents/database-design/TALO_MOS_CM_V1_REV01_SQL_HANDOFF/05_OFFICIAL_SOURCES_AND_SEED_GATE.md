# 05 — Nguồn pháp lý & seed dữ liệu

## Nguồn đã xác minh sự tồn tại qua cổng công khai (2026-10-29)
- Thông tư **90/2026/TT-BTC**, ban hành 30/06/2026, hiệu lực 01/07/2026: https://vanban.chinhphu.vn/?docid=218839&pageid=27160 (trang nguồn; cấu trúc MST và đối tượng phải đối chiếu full văn bản trước khi code validator).
- Quyết định **19/2025/QĐ-TTg**, hiệu lực 01/07/2025: https://vanban.chinhphu.vn/?docid=214409&pageid=27160. Bản tin Chính phủ công bố **34 tỉnh/TP + 3.321 xã/phường/đặc khu** tại mốc ban hành: https://xaydungchinhsach.chinhphu.vn/bang-danh-muc-va-ma-so-cua-34-tinh-thanh-moi-cac-don-vi-hanh-chinh-cap-xa-moi-11925070418263625.htm . Mã tỉnh 2 ký tự, xã 5 ký tự — không dùng integer.
- Nghị quyết **252/2025/QH15**: https://vanban.chinhphu.vn/?docid=216616&pageid=27160 ; danh sách sáu vùng kinh tế gồm 34 tỉnh/TP. Bài báo công bố từ cơ quan địa phương: https://laichau.gov.vn/tin-tuc-su-kien/chuyen-de/tin-trong-nuoc/hoi-nghi-truc-tuyen-cong-bo-dieu-chinh-quy-hoach-tong-the-quoc-gia-va-cac-quy-hoach-vung-thoi-ky-2021-2030-tam-nhin-den-.html

## Seed ứng viên trong ZIP
- `05_PROVINCES_34_CANDIDATE.csv`: mã tỉnh 34 dòng theo bài công bố Chính phủ; tên bỏ tiền tố 'Tỉnh/Thành phố' để khớp nhãn hiển thị; `unit_type_code` phân biệt.
- `05_REGIONS_6_CANDIDATE.csv`: nhãn sáu vùng, cần đối chiếu chính thức trước INSERT.
- `05_PROVINCE_REGION_MAP_34_CANDIDATE.csv`: mỗi tỉnh một vùng kinh tế và miền; phần **vùng kinh tế theo NQ 252**, phần **ba miền là QUY ƯỚC KINH DOANH đề xuất**, không phải mã quốc gia/luật.
- **KHÔNG có ward seed** trong ZIP, vì chưa có danh sách 3.321 dòng được kiểm chứng trọn vẹn cùng checksum và phiên bản. Claude phải tìm nguồn chính thức toàn vẹn (kèm mã tỉnh và mã xã), lưu file source + SHA-256 + bằng chứng số dòng; không được tự dựng tên/mã từ nguồn thứ cấp.

## Seed gate (chỉ là file SQL, chưa chạy)
1. Kiểm tra văn bản mới nhất hoặc văn bản thay thế/cập nhật QĐ 19, NQ 252 và Thông tư 90 tại thời điểm soạn SQL; ghi rõ ngày kiểm tra, đường dẫn chính phủ, trạng thái nguồn. Nếu nguồn không đủ, để `SEED_BLOCKED`, vẫn phát hành DDL candidate và báo rõ không thể nghiệm thu dropdown cấp xã khi thiếu seed.
2. Mỗi seed theo phiên bản/nguồn rõ ràng, không INSERT trực tiếp từ CSV ứng viên nếu chưa rà soát.
3. Kiểm soát danh mục đầy đủ: 34 mã tỉnh + số mã xã/thời điểm theo phụ lục nguồn, mã không trùng, xã có tỉnh hợp lệ, mỗi tỉnh mapping đúng 1 vùng còn hiệu lực.
4. Mọi nguồn có dấu hiệu sửa đổi phải update ứng viên, không âm thầm coi 34/3.321 là vĩnh viễn.
5. Seed ngành bao bì chưa duyệt: **không seed** `cm_customer_groups` trong gói này.
