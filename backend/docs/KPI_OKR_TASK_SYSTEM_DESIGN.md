# KPI / OKR / Weekly Task System Design

## 1. Mục tiêu

Thiết kế này phục vụ quản trị hiệu suất theo team với 3 lớp:

1. **KPI**: theo dõi chỉ số vận hành lặp lại.
2. **OKR**: theo dõi mục tiêu thay đổi và tăng trưởng.
3. **Weekly Task / Sprint**: quản lý task kiểu Agile/Scrum, đóng góp trực tiếp vào `Key Result`.

## 2. Nguyên tắc phân quyền

- Mọi dữ liệu KPI/OKR/Task đều **gắn với một team**.
- Người dùng chỉ thấy dữ liệu của team mà mình có membership `ACTIVE`.
- `OWNER` và `LEAD` có thể:
  - quản lý thành viên team,
  - tạo chu kỳ KPI/OKR,
  - tạo sprint tuần,
  - đánh giá task.
- `MEMBER` có thể cập nhật task, KPI update, check-in OKR trong team của mình.
- `VIEWER` chỉ xem.

## 3. Nhóm model chính

### App `team`

- `Team`: thông tin team, owner, mã mời.
- `TeamMembership`: thành viên thuộc team nào, vai trò gì.
- `TeamInvitation`: mời user khác vào team bằng email / link token / invite code.

### App `kpiokr`

- `PerformanceCycle`: chu kỳ KPI / OKR theo tuần-tháng-quý-năm.
- `KPI`: chỉ số vận hành của team.
- `KPIUpdate`: lịch sử cập nhật KPI.
- `OKRObjective`: mục tiêu cấp team.
- `KeyResult`: kết quả then chốt của một objective.
- `WeeklySprint`: sprint / tuần làm việc.
- `WeeklyTask`: task thực thi, có thể gắn vào `KeyResult`.
- `TaskMetric`: bộ tiêu chí đánh giá task.
- `TaskMetricScore`: điểm đánh giá task theo từng metric.

## 4. Luồng vận hành đề xuất

### 4.1 Chu kỳ OKR

- Thiết lập theo **quý**.
- Mỗi team tạo 3-5 `Objective`.
- Mỗi `Objective` có 2-5 `Key Result`.
- `WeeklyTask` sẽ map vào `KeyResult` để thể hiện đóng góp thực thi.

### 4.2 Chu kỳ KPI

- Thiết lập theo **tháng** hoặc **quý**.
- Mỗi KPI có:
  - baseline,
  - target,
  - current value,
  - weight,
  - frequency cập nhật.
- `KPIUpdate` lưu toàn bộ lịch sử cập nhật để audit.

### 4.3 Sprint / Task tuần

- Mỗi team có `WeeklySprint` theo tuần.
- Task đi qua các trạng thái Scrum cơ bản:
  - `BACKLOG`
  - `TODO`
  - `IN_PROGRESS`
  - `BLOCKED`
  - `IN_REVIEW`
  - `DONE`
  - `CANCELLED`
- Task có thể có:
  - assignee,
  - reviewer,
  - story point,
  - estimate/actual hours,
  - completion percent,
  - due date,
  - KR liên kết.

## 5. Metric đánh giá task mặc định

Khuyến nghị tạo sẵn 5 metric trong `TaskMetric`:

1. **Tiến độ** (`timeliness`) – trọng số 25%
2. **Chất lượng đầu ra** (`quality`) – trọng số 30%
3. **Tác động tới KR** (`impact`) – trọng số 25%
4. **Phối hợp** (`collaboration`) – trọng số 10%
5. **Chủ động** (`ownership`) – trọng số 10%

Thang điểm đề xuất: **1-5** hoặc **1-10**.

Điểm task tổng hợp:

`Tổng điểm = Σ(score x weight) / Σ(weight)`

## 6. Dashboard nên có

### KPI dashboard
- KPI theo team
- KPI theo owner
- KPI sắp chạm ngưỡng cảnh báo
- KPI under target

### OKR dashboard
- Tiến độ Objective theo quý
- KR có rủi ro cao
- Task đóng góp theo KR
- Confidence score theo objective

### Task dashboard
- Burndown theo sprint tuần
- Velocity theo story points
- Tỷ lệ hoàn thành đúng hạn
- Điểm chất lượng task theo reviewer

## 7. Quy tắc hiển thị dữ liệu

Backend nên filter theo:

- `team__memberships__user=request.user`
- `team__memberships__status='ACTIVE'`

Nếu là superuser thì được xem toàn bộ.

## 8. Khả năng mở rộng

Thiết kế này đã mở sẵn cho các nhu cầu sau:

- OKR liên phòng ban
- KPI cá nhân dưới team
- nhiều reviewer cho task
- retrospective cuối sprint
- automation nhắc hạn cập nhật KPI / task overdue
- dashboard so sánh team theo quý
