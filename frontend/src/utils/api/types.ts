// Types
export interface User {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string;
  loginCount: number;
  invitedBy?: string;
  invitedAt?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  updatedAt: string;
  userRoles?: UserRole[];
  permissions?: Permission[];
  is_super_admin?: boolean;
  is_superuser?: boolean;
  is_supperuser?: boolean;
  is_staff?: boolean;
  
  // Additional fields from HRM backend
  employee_profile?: {
    id?: number;
    employee_id?: string;
    full_name?: string;
    department?: string;
    department_code?: string;
    [key: string]: any;
  };
  hrm_user?: {
    employee_id?: string;
    full_name?: string;
    department?: string;
    department_code?: string;
    avatar_url?: string | null;
    [key: string]: any;
  };
  employee_permission?: EmployeePermissions;
  [key: string]: any; // Allow additional properties
}

export interface Permission {
  id: string;
  name: string;
  description?: string;
  resource: string;
  action: string;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  rolePermissions?: { permission: Permission }[];
}

export interface UserRole {
  userId: string;
  roleId: string;
  assignedBy?: string;
  assignedAt: string;
  role: Role;
}

export interface Chatbot {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  avatarUrl?: string;
  isActive: boolean;
  userId: string;
  goal?: string;
  facebookPages?: FacebookPage[];
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  name: string;
  file_key: string;
  file_url?: string;
  file_size: number;
  document_type: string;
  mime_type: string;
  status: string;
  chatbot?: string;
  chatbot_name?: string;
  user: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  documentDomains?: DocumentDomain[];
}

export interface UserProfile {
  id: string;
  platform: string;
  externalId: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  profilePicUrl?: string;
  profilePicPath?: string;
  metadata?: any;
}

export interface Conversation {
  id: string;
  title: string;
  userId: string;
  chatbotId?: string;
  chatbot?: Chatbot;
  messages?: Message[];
  lastMessage?: Message;
  autoReply: boolean;
  contextSummary?: string;
  platform?: string;
  externalId?: string;
  platformMetadata?: any;
  userProfile?: UserProfile;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  metadata?: any;
  createdAt: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export interface ChatResponse {
  response: string;
  conversationId: string;
  messageId: string;
  metadata?: any;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthResponse {
  user: User;
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

// API Key interface
export interface ApiKey {
  id: string;
  name: string;
  key?: string; // Only present on creation
  user: string;
  chatbot?: string;
  chatbot_name?: string;
  status: 'active' | 'inactive' | 'revoked';
  last_used_at?: string;
  expires_at?: string;
  metadata: Record<string, any>;
  is_valid?: boolean;
  created_at: string;
  updated_at: string;
}

export interface FacebookPage {
  id: string;
  name: string;
  accessToken: string;
  category: string;
  categoryList?: Array<{
    id: string;
    name: string;
  }>;
  tasks?: string[];
  picture?: {
    data: {
      url: string;
    };
  };
  isActive: boolean;
  botId?: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BotPermission {
  id: string;
  userId: string;
  chatbotId: string;
  permission: 'read' | 'write' | 'admin';
  assignedBy: string;
  assignedAt: string;
  isActive: boolean;
  expiresAt?: string;
  user?: User;
  chatbot?: Chatbot;
  assignedByUser?: User;
}

export interface FacebookConnection {
  id: string;
  userId: string;
  facebookUserId: string;
  facebookUserName: string;
  accessToken: string;
  tokenExpiresAt: string;
  isActive: boolean;
  pages: FacebookPage[];
  createdAt: string;
  updatedAt: string;
}

// Media API
export interface Media {
  id: string;
  filename: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  mediaType: 'IMAGE';
  userId: string;
  chatbotId?: string;
  tags: string[];
  description?: string;
  isPublic: boolean;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    username: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  chatbot?: {
    id: string;
    name: string;
    description?: string;
  };
}

// Domain interfaces
export interface Domain {
  id: string;
  name: string;
  description?: string;
  chatbotId: string;
  isActive: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
  keywords?: DomainKeyword[];
  documentDomains?: DocumentDomain[];
  _count?: {
    keywords: number;
    documentDomains: number;
  };
}

export interface DomainKeyword {
  id: string;
  domainId: string;
  keyword: string;
  weight: number;
  keywordType: 'primary' | 'secondary' | 'synonym';
  createdAt: string;
}

export interface DocumentDomain {
  id: string;
  documentId: string;
  domainId: string;
  priority: number;
  isActive: boolean;
  assignedBy?: string;
  assignedAt: string;
  document?: Document;
  domain?: Domain;
}

// Employee API Types
export interface Employee {
  id: number;
  employee_id: string;
  full_name: string;
  gender: 'M' | 'F' | 'O';
  date_of_birth?: string;
  phone_number?: string;
  personal_email?: string;
  facebook_link?: string;

  // Thông tin tổ chức
  region?: string;
  block?: string;
  section?: string;
  rank?: string;
  work_location?: string;
  doctor_team?: string;

  // Ngân hàng
  bank_name?: string;
  bank_account?: string;
  bank_branch?: string;

  // BHXH và thuế
  social_insurance_number?: string;
  tax_code?: string;
  household_code?: string;
  insurance_participation?: string;
  insurance_increase_time?: string;
  social_insurance_contribution_level?: number;
  social_insurance_participation_status?: 'PARTICIPATING' | 'NOT_PARTICIPATING' | 'SUSPENDED';
  social_insurance_start_date?: string;
  social_insurance_end_date?: string;

  // Trạng thái
  is_active?: boolean;
  employment_status: 'ACTIVE' | 'SUSPENDED' | 'PAUSED' | 'MATERNITY_LEAVE' | 'INACTIVE' | 'PROBATION';
  employment_status_notes?: string;
  start_date?: string;
  end_date?: string;
  termination_reason?: string;
  total_work_months?: number;

  // Quan hệ tổ chức
  position?: {
    id: number;
    title: string;
    code: string;
    is_management: boolean;
  };
  department?: {
    id: number;
    name: string;
    code: string;
  };
  manager?: {
    id: number;
    employee_id: string;
    full_name: string;
  };
  manager_level_2?: {
    id: number;
    employee_id: string;
    full_name: string;
  };
  manager_level_3?: {
    id: number;
    employee_id: string;
    full_name: string;
  };
  company_unit?: {
    id: number;
    name: string;
    code: string;
  } | null;
  user?: {
    id: number;
    username: string;
    email?: string;
    first_name?: string;
    last_name?: string;
  };

  // Hình thức làm việc và trình độ
  work_form?: string;
  education_level?: string;

  // Onboarding và HR
  basic_salary?: number;
  allowance?: number;
  revenue_percentage?: string;
  profit_percentage?: string;
  contract_type?: string;
  contract_type_display?: string;
  contract_end_date?: string;
  // HĐ hiện tại (latest SIGNED EmployeeContract). Khi có → ưu tiên hiển thị thay cho contract_type / contract_*_date.
  current_contract?: {
    id: number;
    contract_type: string;
    contract_type_display: string;
    template_id: number | null;
    template_name: string | null;
    start_date: string | null;
    end_date: string | null;
    status: string;
    company_unit_id: number | null;
    company_unit_name: string | null;
  } | null;
  probation_end_date?: string;
  official_start_date?: string;
  probation_months?: number;
  probation_rate?: string;
  file_status?: string;
  file_status_display?: string;
  file_submission_deadline?: string;
  file_submission_date?: string;
  file_review_notes?: string;
  training_presentation_viewed?: boolean;
  training_presentation_viewed_at?: string;
  vneid_screenshot?: string;

  // CCCD / VNEID
  cccd_number?: string;
  old_id_number?: string;
  cccd_issue_date?: string;
  cccd_issue_place?: string;
  link_cccd?: string;
  birth_place?: string;
  permanent_residence?: string;
  current_address?: string;
  marital_status?: string;
  ethnicity?: string;
  nationality?: string;

  // Người liên hệ khẩn cấp
  emergency_contact_name?: string;
  emergency_contact_relationship?: string;
  emergency_contact_phone?: string;
  emergency_contact_dob?: string;
  emergency_contact_occupation?: string;
  emergency_contact_address?: string;

  // Ghi chú
  notes?: string;
  salary_notes?: string;
  allowance_notes?: string;

  // Phép năm
  annual_leave_balance?: number;
  annual_leave_balance_year?: number;

  // JSON / misc
  extra_info?: Record<string, unknown>;
  salary_adjustments?: Record<string, unknown>;
  contracts_info?: Record<string, unknown>;
  reporting_path?: string;
  qr_code?: string;

  // Senior Manager & Cấp bậc quản lý
  is_manager?: boolean;
  management_level?: number;
  is_senior_manager?: boolean;

  // HR employee flag
  is_hr?: boolean;
  manager_name: string;
  manager_level_2_name?: string | null;
  manager_level_2_employee_id?: string | null;
  created_at: string;
  updated_at: string;

  // Avatar
  avatar_url?: string | null;

  // Hồ sơ giấy tờ
  doc_resume?: boolean;
  doc_cccd?: boolean;
  doc_degree?: boolean;
  doc_health?: boolean;

  // Tài khoản Nurse App (cskh-app-backend)
  nurse_app_username?: string | null;
}

export interface EmployeePermissions {
  can_approve_attendance: boolean;
  can_approve_leave: boolean;
  can_approve_overtime: boolean;
  can_create_employee: boolean;
  can_edit_employee: boolean;
  can_view_all_employees: boolean;
  can_manage_attendance: boolean;
  can_import_attendance: boolean;
  can_adjust_attendance: boolean;
  can_edit_attendance: boolean;
  can_manage_assets: boolean;
  can_assign_assets: boolean;
  can_approve_asset_requests: boolean;
  can_manage_departments: boolean;
  can_manage_positions: boolean;
  can_manage_company_config: boolean;
  can_manage_attendance_rules: boolean;
  can_manage_leave_policies: boolean;
  can_view_reports: boolean;
  can_export_reports: boolean;
  can_manage_disciplinary_penalties: boolean;
  can_view_salary_advance?: boolean;
  can_manage_recruitment?: boolean;
  can_view_dashboard_overview?: boolean;
  can_view_dashboard_employee?: boolean;
  can_view_dashboard_recruitment?: boolean;
  can_view_dashboard_insurance?: boolean;
  can_view_dashboard_asset?: boolean;
  has_any_permission: boolean;
  permission_summary: string;
}

export interface SuperAdminEmployee extends Employee {
  probation_salary_percentage?: number;
  probation_salary_percentage_display?: string;
  permissions?: EmployeePermissions;
  user?: {
    id: number;
    username: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    is_staff?: boolean;
    is_superuser?: boolean;
  };
}

export interface Department {
  id: number;
  name: string;
  code: string;
  description?: string;
  parent_department?: number | null;
  manager?: number | null;
  manager_id?: number | null;
  manager_name?: string | null;
  is_section?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Position {
  id: number;
  title: string;
  code: string;
  description?: string;
  department?: Array<{
    id: number;
    name: string;
    code: string;
  }>;
  department_ids?: number[];
  level: number;
  parent_position?: number;
  is_management: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmployeeCreateData {
  employee_id: string;
  full_name: string;
  gender: 'M' | 'F' | 'O';
  date_of_birth?: string;
  phone_number?: string;
  personal_email?: string;
  bank_name?: string;
  bank_account?: string;
  employment_status?: 'ACTIVE' | 'SUSPENDED' | 'PAUSED' | 'MATERNITY_LEAVE' | 'INACTIVE' | 'PROBATION';
  start_date?: string;
  end_date?: string;
  username: string;
  password: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  position_id?: number;
  department_id?: number;
  manager_id?: number;
  is_hr?: boolean;
}

export interface EmployeeUpdateData {
  employee_id?: string;
  full_name?: string;
  gender?: 'M' | 'F' | 'O';
  date_of_birth?: string;
  phone_number?: string;
  personal_email?: string;
  ethnicity?: string;
  nationality?: string;
  bank_name?: string;
  bank_account?: string;
  cccd_number?: string;
  cccd_issue_date?: string;
  cccd_issue_place?: string;
  permanent_residence?: string;
  current_address?: string;
  social_insurance_contribution_level?: number | null;
  social_insurance_participation_status?: 'PARTICIPATING' | 'NOT_PARTICIPATING' | 'SUSPENDED' | null;
  social_insurance_start_date?: string | null;
  social_insurance_end_date?: string | null;
  employment_status?: 'ACTIVE' | 'SUSPENDED' | 'PAUSED' | 'MATERNITY_LEAVE' | 'INACTIVE' | 'PROBATION';
  start_date?: string;
  end_date?: string;
  user_id?: number;
  position_id?: number;
  department_id?: number;
  manager_id?: number;
  is_hr?: boolean;
  marital_status?: string | null;
  file_status?: string;
  file_review_notes?: string;
  doc_resume?: boolean;
  doc_cccd?: boolean;
  doc_degree?: boolean;
  doc_health?: boolean;
}

// Asset API Types
export interface Asset {
  id: number;
  asset_code: string;
  name: string;
  asset_type: string;
  asset_type_display: string;
  brand: string;
  model: string;
  serial_number?: string;
  status: string;
  status_display: string;
  condition: string;
  condition_display: string;
  department?: number;
  department_name?: string;
  // Kích thước vật lý +
  // nơi thực tế đang sử dụng — usage_department khác `department` ở trên
  // (department = phòng ban QUẢN LÝ trong kho, usage_department = phòng ban
  // đang thực tế SỬ DỤNG). "Người sử dụng" dùng chung assigned_to, không có
  // field riêng.
  dimensions?: string;
  usage_area?: string;
  facility_code?: string;
  usage_department?: number;
  usage_department_name?: string;
  usage_department_code?: string;
  managed_by?: number;
  managed_by_name?: string;
  managed_by_employee_id?: string;
  assigned_to?: number;
  assigned_to_name?: string;
  assigned_to_employee_id?: string;
  assigned_to_department_name?: string;
  assigned_date?: string;
  purchase_date?: string;
  purchase_price: number;
  warranty_expiry?: string;
  invoice_number?: string;
  supplier?: string;
  location?: string;
  description?: string;
  specifications?: {
    cpu?: string;
    ram?: string;
    vga?: string;
    storage?: string;
    mainboard?: string;
    power_supply?: string;
    phone_number?: string;
    network_provider?: string;
    quantity?: number;
    type_name?: string;
    details?: string;
  };
  other_details?: string;
  warranty_period?: number;
  // Khấu hao — monthly_depreciation/accumulated_depreciation/current_value tính động
  // ở backend (không lưu DB), luôn khớp thời điểm hiện tại.
  depreciation_period_months?: number | null;
  depreciation_method?: string;
  depreciation_method_display?: string;
  monthly_depreciation?: number | null;
  accumulated_depreciation?: number | null;
  current_value?: number | null;
  // Hình ảnh — presigned URL, field ghi là multipart file 'current_image'/'purchase_image'
  current_image_url?: string | null;
  purchase_image_url?: string | null;
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
  deleted_at?: string;
  total_quantity?: number;
  remaining_quantity?: number;
  assigned_quantity_total?: number;
  my_assigned_quantity?: number;
  holders?: Array<{
    history_id: number;
    employee_id: number;
    employee_code?: string;
    name: string;
    department_name?: string;
    assigned_quantity: number;
    assigned_date: string;
    assignment_notes?: string;
  }>;
  pending_assignment?: {
    id: number;
    assigned_to?: number;
    assigned_to_name?: string;
    assigned_date?: string;
    assigned_by_name?: string;
    assignment_notes?: string;
  } | null;
}

export type AssetAssignmentStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'RETURNED';

export interface AssetAssignmentHistory {
  id: number;
  asset: number;
  asset_code: string;
  asset_name: string;
  asset_type?: string;
  asset_type_display?: string;
  asset_brand?: string;
  asset_model?: string;
  asset_serial_number?: string;
  asset_specifications?: Record<string, any> | null;
  assigned_to: number;
  assigned_to_name: string;
  assigned_to_employee_id?: string;
  assigned_date: string;
  returned_date?: string | null;
  status: AssetAssignmentStatus;
  status_display: string;
  confirmed_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  return_condition?: string | null;
  return_condition_display?: string | null;
  return_notes?: string | null;
  assignment_notes?: string | null;
  assigned_by?: number | null;
  assigned_by_name?: string | null;
  assigned_by_employee_id?: string;
  created_at: string;
  duration_days?: number | null;
  assigned_quantity?: number;
}

export interface AssetMaintenance {
  id: number;
  asset: number;
  asset_code: string;
  asset_name: string;
  maintenance_date: string;
  maintenance_type: string;
  maintenance_type_display: string;
  description: string;
  performed_by?: string;
  performed_by_employee?: number;
  performed_by_employee_name?: string;
  cost: number;
  result: string;
  next_maintenance_date?: string;
  created_at: string;
  updated_at: string;
}

export type AssetInventoryCheckResult = 'MATCH' | 'MISSING' | 'DAMAGED' | 'WRONG_HOLDER' | 'OTHER';

export interface AssetInventoryCheck {
  id: number;
  asset: number;
  asset_code: string;
  asset_name: string;
  check_date: string;
  checked_by?: number | null;
  checked_by_name?: string;
  actual_condition?: string;
  actual_condition_display?: string;
  result: AssetInventoryCheckResult;
  result_display: string;
  notes?: string;
  created_at: string;
  created_by?: number | null;
  created_by_name?: string;
}

export interface AssetStats {
  total: number;
  in_use: number;
  idle: number;
  under_maintenance: number;
  damaged: number;
  retired: number;
  total_value: number;
  expired_warranty: number;
  type_stats: Array<{
    asset_type: string;
    asset_type_display: string;
    count: number;
  }>;
  department_stats: Array<{
    department_name: string;
    count: number;
  }>;
  deleted_count: number;
}

// Company Configuration API Types
export interface CompanyConfig {
  id: number;
  code: string;
  name: string;
  description?: string;
  default_working_hours_per_day: number;
  default_working_days_per_week: number;
  overtime_multiplier_weekday: number;
  overtime_multiplier_weekend: number;
  overtime_multiplier_holiday: number;
  late_threshold_minutes: number;
  early_leave_threshold_minutes: number;
  half_day_threshold_hours: number;
  annual_leave_days_per_year: number;
  sick_leave_days_per_year: number;
  maternity_leave_days: number;
  paternity_leave_days: number;
  max_explanation_count_per_month: number;
  supplement_work_hours_per_month: number;
  is_active: boolean;
  effective_from: string;
  effective_to?: string;
  created_by?: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  is_current?: boolean;
}

export interface ShiftConfig {
  id: number;
  code: string;
  name: string;
  description?: string;
  start_time: string;
  end_time: string;
  break_start_time?: string;
  break_end_time?: string;
  break_duration_minutes?: number;
  total_hours: number;
  working_hours: number;
  /** Số công cố định của ca; null = tự tính theo giờ làm */
  fixed_workday?: number | string | null;
  shift_type: string;
  shift_type_display: string;
  apply_scope?: 'CA_NHAN' | 'VI_TRI' | 'PHONG_BAN' | 'DEFAULT' | null;
  apply_scope_display?: string;
  apply_to_departments?: number[];
  apply_to_positions?: number[];
  apply_to_employees?: number[];
  effective_from: string;
  effective_to?: string;
  is_active: boolean;
  is_default: boolean;
  created_by?: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  is_current?: boolean;
}

export interface HolidayConfig {
  id: number;
  name: string;
  description?: string;
  holiday_date: string;
  is_recurring: boolean;
  holiday_type: string;
  holiday_type_display: string;
  is_working_day: boolean;
  allow_voluntary_work: boolean;
  overtime_multiplier: number;
  apply_to_all: boolean;
  excluded_departments?: number[];
  excluded_positions?: number[];
  excluded_employees?: number[];
  notes?: string;
  is_active: boolean;
  created_by?: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  is_today?: boolean;
  is_holiday_today?: boolean;
}

export interface CurrentCompanyConfig {
  company_config?: CompanyConfig;
  current_shifts: ShiftConfig[];
  upcoming_holidays: HolidayConfig[];
  today_holidays: HolidayConfig[];
  today: string;
}

// Attendance Rule Configuration API Types
export interface AttendanceRuleConfig {
  id: number;
  code: string;
  name: string;
  description?: string;
  rule_type: string;
  rule_type_display: string;
  configuration: any;
  work_hours_calculation?: any;
  late_early_config?: any;
  overtime_config?: any;
  break_time_config?: any;
  apply_to_all: boolean;
  apply_to_departments?: number[];
  apply_to_positions?: number[];
  apply_to_employees?: number[];
  is_active: boolean;
  is_default: boolean;
  effective_from: string;
  effective_to?: string;
  created_by?: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  is_current?: boolean;
}

export interface AttendanceRuleHistory {
  id: number;
  attendance: number;
  attendance_code: string;
  attendance_date: string;
  rule: number;
  rule_code: string;
  rule_name: string;
  applied_by?: number;
  applied_by_name?: string;
  applied_at: string;
  calculation_result: any;
  notes?: string;
  created_at: string;
}

export interface LeavePolicyConfig {
  id: number;
  code: string;
  name: string;
  description?: string;
  leave_type: string;
  leave_type_display: string;
  max_days_per_year: number;
  max_consecutive_days: number;
  advance_notice_days: number;
  emergency_notice_hours: number;
  requires_approval: boolean;
  requires_medical_certificate: boolean;
  medical_certificate_days_threshold: number;
  allow_half_day: boolean;
  allow_carry_over: boolean;
  max_carry_over_days: number;
  apply_to_all: boolean;
  apply_to_departments?: number[];
  apply_to_positions?: number[];
  apply_to_employees?: number[];
  is_active: boolean;
  effective_from: string;
  effective_to?: string;
  created_by?: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
  is_current?: boolean;
}

export interface AttendanceRuleEngineRequest {
  employee_id: number;
  attendance_date: string;
  check_in?: string;
  check_out?: string;
  shift_type?: string;
  rule_id?: number;
}

export interface AttendanceRuleEngineResponse {
  status: string;
  applied_rule?: AttendanceRuleConfig;
  calculation_result: any;
  work_hours: number;
  work_coefficient: number;
  late_minutes?: number;
  early_leave_minutes?: number;
  overtime_hours?: number;
  break_time_minutes?: number;
  notes?: string;
}

export interface BirthdayWish {
  id: number;
  recipient: { id: number; employee_id: number; full_name: string; avatar_url?: string | null };
  sender: { id: number; employee_id: number; full_name: string; avatar_url?: string | null };
  message: string;
  year: number;
  is_liked?: boolean;
  created_at?: string;
}

export interface CompanyUnit {
  id: number;
  name: string;
  code: string;
  prefix_code?: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
