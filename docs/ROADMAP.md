# Roadmap

Các tính năng dự kiến bổ sung, chia theo giai đoạn.

## Nguyên tắc

1. **Không đổi hành vi mặc định.** Tính năng thuộc loại "quy tắc" (chấm công, phạt, lương) phải là
   tuỳ chọn cấu hình; khi chưa cấu hình, hệ thống chạy như hiện tại.
2. **Migration sinh bằng `makemigrations`** trên repo này, không viết tay số thứ tự.
3. Mỗi tính năng là một nhánh/PR riêng, kèm test backend và FE build qua (`npm run build`).

Cỡ việc: **S** ≈ ½–1 ngày · **M** ≈ 2–4 ngày · **L** ≈ 1–2 tuần. ✅ = đã xong.

---

## Giai đoạn 1: module độc lập

| # | Tính năng | Cỡ | Ghi chú |
| --- | --- | --- | --- |
| 1.1 | ✅ **Người phụ thuộc** (giảm trừ gia cảnh) trên hồ sơ NV | S | Model riêng thay cho trường "số người phụ thuộc"; sau đó nối vào bảng lương. |
| 1.2 | ✅ **Chứng từ thanh toán / đề xuất mua hàng / đề nghị tạm ứng**: đính kèm file, trạng thái, đánh dấu đã soát, xuất Excel | M | Một tab trong "Đơn từ", chỉ HR/Admin thấy. |
| 1.3 | ✅ **Kiểm kê tài sản** + giao diện ghi bảo trì | S | API bảo trì đã có, chỉ thiếu UI. |
| 1.4 | ✅ **Ảnh tài sản + khấu hao đường thẳng** | S–M | Các field đã có trong model. |
| 1.5 | ✅ **Mã QR tài sản** + đăng nhập chuyển hướng `/login?redirect=` | S | Cần thư viện `qrcode`. |
| 1.6 | ✅ **Import phòng ban / vị trí từ Excel** | S | Chỉ HR/Admin. |
| 1.7 | ✅ **Từ chối hàng loạt** trên trang Phê duyệt | S | Đặt cạnh `bulk_approve`. |
| 1.8 | ✅ **Khoá dòng chốt công đã sửa tay** + trang "Data chốt công" | S | Để "Chốt công tất cả" không ghi đè số đã sửa tay. |
| 1.9 | ✅ **Cảnh báo mâu thuẫn ngày / loại hợp đồng** trên form sửa NV | S | Chỉ sửa FE. |
| 1.10 | ✅ **Xuất Excel nhân viên theo cột tuỳ chọn** | S | Mở quyền `export-all` cho Admin/HR. |
| 1.11 | ✅ **Cảnh báo quan trọng**: HĐ sắp/đã hết hạn, đến hạn đóng BHXH, kèm popup | S–M | Các ngưỡng ngày phải cấu hình được. |
| 1.12 | ✅ **Dự đoán chi phí thưởng** (tháng 13 / cuối năm) | S | |
| 1.13 | ✅ **Placeholder hợp đồng mở rộng**: số tiền bằng chữ, ngày ký, giới tính… | S | Giữ tương thích các placeholder cũ. |
| 1.14 | ✅ Loại tài liệu **Phụ lục hợp đồng** | S | |
| 1.15 | ✅ **Dữ liệu lương**: ghi đè tiền ăn trưa, gửi xe "điền 0 cho phần còn lại", phân trang + dòng tổng | S | |
| 1.16 | ✅ Cải tiến nhỏ: báo cáo vi phạm cho mọi phòng ban, lọc "sắp hết thử việc", hiển thị Họ Tên đúng thứ tự, xem PDF trên Android, nhãn ca rõ hơn, `DateInput`, `formatVND` | S | Bỏ phần nhãn ca: đăng ký ca (Ca 1/Ca 2) đã hiện đủ giờ sáng/chiều. Báo cáo vi phạm giới hạn quyền xem theo vai trò. |
| 1.17 | ✅ CI chặn migration có nhiều nhánh lá | S | |

## Giai đoạn 2: mở rộng tính năng lõi

| # | Tính năng | Cỡ | Ghi chú |
| --- | --- | --- | --- |
| 2.1 | ✅ **Tách hàm `get_salary_rows()`** khỏi `SalaryDepartmentView`, bỏ `FakeRequest` trong `salary/views.py` | M | Điều kiện để làm 2.2 và 3.1. Kết quả tính lương phải giữ nguyên. |
| 2.2 | ✅ **Báo cáo biến động lương** giữa 2 tháng | M | Cần 2.1. |
| 2.3 | ✅ **Xuất bảng lương nhiều tháng** + lọc Đang làm / Đã nghỉ | S–M | |
| 2.4 | ✅ **Link tự cập nhật hồ sơ** cho NV đang làm (dùng lại form onboarding) | S–M | |
| 2.5 | ✅ **Lịch sử trạng thái NV** + trạng thái Nghỉ thai sản | M | |
| 2.6 | ✅ **Thêm loại hợp đồng**: 6 tháng, 3 năm, thử việc 1–2 tháng | S–M | Mọi chỗ kiểm tra "thử việc / chưa chính thức" phải nhận mã mới. |
| 2.7 | ✅ **Quản lý BHXH theo kỳ** (nhiều bản ghi mỗi NV, tỷ lệ NLĐ/DN) | M | Giữ trường trên hồ sơ làm "hiện tại" (tự cập nhật theo kỳ hiện hành) + bảng kỳ đóng; bảng lương lấy mức đóng theo kỳ của tháng, NV chưa có kỳ nào dùng trường trên hồ sơ. |
| 2.8 | ✅ **Thông tin sử dụng tài sản** + file mẫu import; tách người sử dụng / người bàn giao | M | |
| 2.9 | ✅ **Phân loại tài sản nhập tự do** | M | |
| 2.10 | ✅ **Hạn mức ngày online theo NV / vị trí / phòng ban** | M | Mặc định lấy `CompanyConfig.max_online_work_count_per_month`. |
| 2.11 | ✅ **Số công cố định của ca** (`ShiftConfig.fixed_workday`) | S–M | Để trống thì không có tác dụng. |
| 2.12 | ✅ **Chế độ con nhỏ**: đi muộn / về sớm tối đa N phút | M | N cấu hình được. |
| 2.13 | ✅ **Phạt thiếu công** theo danh sách NV được chọn | S–M | Danh sách rỗng thì không có tác dụng. |
| 2.14 | ✅ **Đơn giải trình "Lỗi máy chấm công"** | M | Không tính vào hạn mức giải trình. |
| 2.15 | ✅ **Khoá NV tự sửa hồ sơ** | S | Giới hạn trường được tự sửa luôn bật (bảo mật); khoá hẳn đặt sau cờ `CompanyConfig.lock_employee_self_edit`, mặc định tắt. |
| 2.16 | ⛔ ~~**Vai trò BOD xem lương**~~ | S | Không làm: giữ "chỉ admin" xem lương. |

## Giai đoạn 3: tính năng lớn

| # | Tính năng | Cỡ | Ghi chú |
| --- | --- | --- | --- |
| 3.1 | ✅ **Chốt lương tháng**: snapshot bất biến, khoá dữ liệu lương của tháng (HTTP 423), chặn gửi phiếu lương khi chưa chốt | L | Cần 2.1. |
| 3.2 | ✅ **Điều chỉnh nhân sự có ngày hiệu lực** (phòng ban / vị trí / lương), huỷ được, có log | M–L | Phần lương ghi vào `EmployeeSalaryHistory`. |
| 3.3 | ✅ **Hạn mức giải trình theo từng loại** + rổ gộp cho trưởng phòng | L | Có 2 chế độ: COMBINED (mặc định) và PER_TYPE. |
| 3.4 | ✅ **Kế hoạch ca theo tuần**: chọn ca tự do, duyệt 2 bước, khoá, nhập / xuất Excel | L | Model `WeeklyShiftPlan` (tách khỏi `ShiftRegistration`); kế hoạch đã duyệt được ưu tiên khi chấm công. |
| 3.5 | Ca online cộng thêm (không cần chấm) | M | Làm sau 3.4. |
| 3.6 | Cấu hình lương theo mốc hiệu lực | L | Hoãn, vì chủ yếu là nợ kỹ thuật. |
| 3.7 | Tối ưu giao diện cho điện thoại | L | Làm dần theo từng trang. |

---

## Nợ kỹ thuật / việc cần xem lại

- **Công đoàn trong tiền trừ lương — backend và giao diện đang lệch nhau** (cần chốt quy tắc):
  - `build_salary_row` ([finalization_views.py](../backend/hrm/finalization_views.py)) trừ
    `EMPLOYEE_BH_TOTAL_RATE` = 8% + 1,5% + 1% + **1% công đoàn** = 11,5% mức đóng BH vào
    `luong_thuc_linh`, và không trừ khoản `cong_doan` của cấu hình lương.
  - Giao diện bảng lương / phiếu lương (`SalaryManagement.tsx`) và email phiếu lương trừ 10,5% +
    `cong_doan` theo cấu hình (`payroll_config.deductions.unionFee`).
  - Hệ quả: `luong_thuc_linh` / `con_phai_thanh_toan` của API (dùng ở báo cáo so sánh, bản chốt lương)
    có thể khác số hiển thị trên phiếu lương. Cần chọn 1 quy tắc rồi sửa phía còn lại.
- **Địa điểm làm việc** đang là danh sách cố định (`WORK_LOCATION` trong `employee/models.py` và
  `frontend/src/constants/onboarding.ts`). Nên chuyển thành dữ liệu cấu hình.
- Migration mới chỉ kiểm tra trên SQLite, **chưa chạy thử trên PostgreSQL**.
