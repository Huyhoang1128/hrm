 // ============================================ . .   
// Onboarding Constants — shared between EmployeeOnboardingForm & OnboardingDetail
// ============================================

export const ETHNICITY_OPTIONS = [
  'Kinh', 'Tày', 'Thái', 'Mường', 'Khơ Me', 'Hoa', 'Nùng', 'H\'Mông', 'Dao',
  'Gia Rai', 'Ê Đê', 'Ba Na', 'Xơ Đăng', 'Sán Chay (Cao Lan - Sán Chỉ)', 'Cơ Ho',
  'Chăm', 'Sán Dìu', 'Hrê', 'Mnông', 'Ra Glai', 'Bru - Vân Kiều', 'Thổ', 'Giẻ Triêng',
  'Co', 'Ma', 'Giáy', 'Tà Ôi', 'Hà Nhì', 'Chơ Ro', 'Khang', 'Xinh Mun', 'Chu Ru',
  'Lao', 'La Chí', 'La Ha', 'Phù Lá', 'La Hủ', 'Lự', 'Lô Lô', 'Chứt', 'Mảng',
  'Pà Thẻn', 'Co Lao', 'Cống', 'Bố Y', 'Si La', 'Pu Péo', 'Brâu', 'Rơ Măm',
  'Ơ Đu', 'Pa Dí', 'Thù Lao', 'Ngạn', 'Phén',
];

export const NATIONALITY_OPTIONS = [
  // Đông Nam Á
  'Việt Nam', 'Thái Lan', 'Singapore', 'Malaysia', 'Indonesia', 'Philippines',
  'Campuchia', 'Lào', 'Myanmar', 'Brunei', 'Timor-Leste',
  // Đông Á
  'Trung Quốc', 'Nhật Bản', 'Hàn Quốc', 'Đài Loan', 'Mông Cổ',
  // Nam Á
  'Ấn Độ', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal', 'Bhutan', 'Maldives', 'Afghanistan',
  // Trung Á
  'Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan',
  // Tây Á / Trung Đông
  'Thổ Nhĩ Kỳ', 'Iran', 'Iraq', 'Ả Rập Saudi', 'UAE', 'Qatar', 'Kuwait', 'Bahrain', 'Oman',
  'Yemen', 'Jordan', 'Lebanon', 'Syria', 'Israel', 'Palestine', 'Georgia', 'Armenia', 'Azerbaijan',
  // Châu Âu — Tây
  'Anh', 'Pháp', 'Đức', 'Hà Lan', 'Bỉ', 'Luxembourg', 'Áo', 'Thụy Sĩ', 'Ireland',
  'Monaco', 'Liechtenstein', 'Andorra',
  // Châu Âu — Bắc
  'Thụy Điển', 'Na Uy', 'Đan Mạch', 'Phần Lan', 'Iceland',
  // Châu Âu — Nam
  'Ý', 'Tây Ban Nha', 'Bồ Đào Nha', 'Hy Lạp', 'Malta', 'Cyprus', 'San Marino', 'Vatican',
  // Châu Âu — Đông
  'Nga', 'Ba Lan', 'Séc', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Ukraine', 'Belarus',
  'Moldova', 'Lithuania', 'Latvia', 'Estonia', 'Croatia', 'Slovenia', 'Serbia',
  'Bosnia và Herzegovina', 'Montenegro', 'Bắc Macedonia', 'Albania', 'Kosovo',
  // Bắc Mỹ
  'Hoa Kỳ', 'Canada', 'Mexico',
  // Trung Mỹ & Caribbean
  'Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama',
  'Cuba', 'Jamaica', 'Haiti', 'Cộng hòa Dominica', 'Trinidad và Tobago', 'Barbados', 'Bahamas',
  // Nam Mỹ
  'Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Venezuela', 'Ecuador',
  'Bolivia', 'Paraguay', 'Uruguay', 'Guyana', 'Suriname',
  // Châu Phi — Bắc
  'Ai Cập', 'Libya', 'Tunisia', 'Algeria', 'Morocco', 'Sudan',
  // Châu Phi — Tây
  'Nigeria', 'Ghana', 'Senegal', 'Mali', 'Bờ Biển Ngà', 'Cameroon', 'Guinea',
  'Burkina Faso', 'Niger', 'Togo', 'Benin', 'Sierra Leone', 'Liberia',
  // Châu Phi — Đông
  'Kenya', 'Ethiopia', 'Tanzania', 'Uganda', 'Rwanda', 'Burundi', 'Somalia',
  'Madagascar', 'Mozambique', 'Zimbabwe', 'Zambia', 'Malawi',
  // Châu Phi — Nam
  'Nam Phi', 'Namibia', 'Botswana', 'Lesotho', 'Eswatini', 'Angola',
  // Châu Phi — Trung
  'Cộng hòa Dân chủ Congo', 'Cộng hòa Congo', 'Gabon', 'Chad',
  'Cộng hòa Trung Phi', 'Guinea Xích Đạo',
  // Châu Đại Dương
  'Úc', 'New Zealand', 'Papua New Guinea', 'Fiji', 'Samoa', 'Tonga', 'Vanuatu',
  'Quần đảo Solomon', 'Kiribati', 'Palau',
];

export const SECTION_OPTIONS = [
  { value: 'ADS', label: 'ADS' },
  { value: 'BENH_VIEN_HA_THANH', label: 'Bệnh viện Hà Thành' },
  { value: 'BENH_VIEN_30_4', label: 'Bệnh viện 30/4' },
  { value: 'BENH_VIEN_AN_VIET', label: 'Bệnh viện An Việt' },
  { value: 'BENH_VIEN_HONG_HA', label: 'Bệnh viện Hồng Hà' },
  { value: 'BENH_VIEN_TAN_HUNG', label: 'Bệnh Viện Tân Hưng' },
  { value: 'BENH_VIEN_SAO_HAN', label: 'Bệnh viện Sao Hàn' },
  { value: 'BENH_VIEN_VAN_HANH', label: 'Bệnh viện Vạn Hạnh' },
  { value: 'CHECK_PAGE', label: 'Check page' },
  { value: 'XAY_GROUP', label: 'Xây Group' },
  { value: 'TIKTOK', label: 'Tiktok' },
  { value: 'GIAM_SAT_CHAT_LUONG', label: 'Giám sát chất lượng' },
  { value: 'GIAM_SAT_NOI_BO', label: 'Giám sát nội bộ' },
  { value: 'MEDIA', label: 'Media' },
  { value: 'NOI_DUNG_01', label: 'Nội dung 01' },
  { value: 'PHONG_HCNS', label: 'Phòng HCNS' },
  { value: 'PHONG_KE_TOAN', label: 'Phòng kế toán' },
  { value: 'PHONG_TTTH', label: 'Phòng TTTH' },
  { value: 'KINH_DOANH_VP_MIEN_BAC', label: 'Kinh doanh - VP miền Bắc' },
  { value: 'KINH_DOANH_VP_MIEN_NAM', label: 'Kinh doanh - VP miền Nam' },
  { value: 'PHAP_CHE', label: 'Pháp chế' },
  { value: 'MUA_HANG', label: 'Mua hàng' },
  { value: 'BO_PHAN_AI', label: 'Bộ phận AI' },
  { value: 'BO_PHAN_IT', label: 'Bộ phận IT' },
];

export const WORK_FORM_OPTIONS = [
  { value: 'FULL_TIME', label: 'Full-time' },
  { value: 'PART_TIME', label: 'Part-time' },
];

export const WORK_LOCATION_OPTIONS = [
  { value: 'VP_HA_NOI', label: 'Văn phòng Hà Nội' },
  { value: 'VP_HCM', label: 'Văn phòng TP. Hồ Chí Minh' },
];

export const CITIZEN_ID_ISSUE_PLACE_OPTIONS = [
  { value: 'POLICE_ADMIN', label: 'Cục cảnh sát Quản lý hành chính về Trật tự xã hội' },
  { value: 'MINISTRY_PUBLIC_SECURITY', label: 'Bộ Công An' },
];

export const EDUCATION_LEVEL_OPTIONS = ['Thạc sĩ', 'Cử nhân đại học', 'Cử nhân cao đẳng', 'Trung cấp', 'Khác'];

export const SUB_DEPARTMENT_OPTIONS = [
  'ADS', 'ADS2', 'KD 1', 'KD 2', 'KD 3', 'KD 4', 'KD MN',
  'CSKH MB', 'CSKH MN', 'Media', 'Giám sát nội bộ',
  'HCNS', 'Kế toán', 'Truyền thông',
  'TTTH 01', 'TTTH 02', 'TTTH 03', 'TTTH 04', 'TTTH 06',
  'Xây group', 'TTTH 08', 'TTTH 05', 'TTTH 07', 'TTTH 09',
  'TTTH 10', 'TTTH 11', 'Tiktok 1', 'Tiktok 2', 'Tiktok 3',
  'Tiktok 5', 'TTTH 15', 'Pháp chế', 'Tiktok 4', 'KD 5',
  'Mua hàng', 'Công nghệ thông tin', 'Tiktok 6', 'Tiktok 7',
  'Tiktok 8', 'Tiktok 9', 'Tiktok 10',
];

export const RANK_OPTIONS = [
  'Nhân viên', 'Leader', 'Quản lý', 'Trưởng phòng tập sự', 'Phó phòng',
  'Trưởng phòng', 'Phó Giám đốc', 'Giám đốc', 'Chủ tịch',
];

export const POSITION_OPTIONS = [
  'Nhân viên Sale', 'Nhân viên Kinh doanh', 'Nhân viên Telesale', 'Trưởng phòng Telesale',
  'Nhân viên CSKH', 'Trưởng phòng CSKH', 'Nhân viên Tư vấn',
  'Chăm sóc, tiếp nhận khách', 'Chăm sóc hậu phẫu',
  'Nhân viên Marketing', 'Nhân viên ADS', 'Trưởng phòng ADS', 'Nhân viên Content', 'Trưởng phòng Content',
  'Nhân viên Seeding', 'Trưởng phòng Seeding', 'Nhân viên Truyền thông thương hiệu', 'Trưởng phòng Truyền thông thương hiệu',
  'Truyền thông nội bộ',
  'Nhân viên Media', 'Trưởng phòng Media', 'Nhân viên TikTok', 'Xây group',
  'Nhân viên Thiết kế', 'Nhân viên Editor/Dựng phim', 'Biên tập viên', 'Biên kịch', 'Checkpage', 'Trợ lý hình ảnh', 'Quay - Chụp', 'Tổ chức sản xuất',
  'Bác sĩ', 'Trợ lý bác sĩ', 'Điều dưỡng', 'Y tá', 'Kỹ thuật viên', 'Phụ tá',
  'Nhân viên Hành chính - Nhân sự', 'Trưởng phòng Hành chính - Nhân sự', 'Giám đốc Hành chính - Nhân sự',
  'Nhân viên C&B', 'Nhân viên Tuyển dụng', 'Trưởng phòng Tuyển dụng',
  'Nhân viên Pháp chế', 'Trưởng phòng Pháp chế', 'Giám đốc Pháp chế',
  'Phiên dịch viên', 'Nhân viên IT', 'Nhân viên AI', 'Trưởng phòng IT', 'Trưởng phòng AI',
  'Nhân viên Kế toán', 'Kế toán trưởng', 'Thủ quỹ', 'Thực tập sinh', 'Lễ tân', 'Giám sát nội bộ', 'Giám sát chất lượng', 'Trưởng phòng Giám sát',
  'Lái xe', 'Tạp vụ', 'Bảo vệ',
  'Phó phòng',
  'Giám đốc', 'Phó Giám đốc',
];


export const REGION_OPTIONS = ['Miền Bắc', 'Miền Nam'];
export const BLOCK_OPTIONS = ['Khối Back office', 'Khối Marketing', 'Khối Kinh doanh'];

export const MARITAL_STATUS_OPTIONS = [
  { value: 'SINGLE', label: 'Độc thân' },
  { value: 'MARRIED', label: 'Đã kết hôn' },
  { value: 'DIVORCED', label: 'Ly hôn' },
  { value: 'WIDOWED', label: 'Góa' },
];

export const GENDER_OPTIONS = [
  { value: 'M', label: 'Nam' },
  { value: 'F', label: 'Nữ' },
  { value: 'O', label: 'Khác' },
];

export const PROBATION_MONTHS_OPTIONS = [
  { value: '0', label: 'Không thử việc' },
  { value: '1', label: '1 tháng' },
  { value: '2', label: '2 tháng' },
  { value: '3', label: '3 tháng' },
  { value: '6', label: '6 tháng' },
];

export const PROBATION_RATE_OPTIONS = [
  { value: 'OPTION_1', label: 'Tháng đầu 85%, tháng sau 85%' },
  { value: 'OPTION_2', label: 'Tháng đầu 85%, tháng sau 100%' },
  { value: 'OPTION_3', label: 'Tháng đầu 100%, tháng sau 100%' },
];
