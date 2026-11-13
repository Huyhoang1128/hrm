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

// Danh sách bộ phận / phòng ban / vị trí / cấp bậc / vùng / khối / học vấn: lấy từ backend
// (API danh mục + GET /api-hrm/system-rules/ section "choices"), không ghi cứng ở đây.

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
