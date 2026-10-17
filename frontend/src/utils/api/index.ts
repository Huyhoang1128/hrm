// Re-export client
export { API_BASE_URL, managementApi } from './client';

// Re-export all types
export type {
  User,
  Permission,
  Role,
  UserRole,
  LoginCredentials,
  RegisterData,
  AuthResponse,
  Employee,
  EmployeePermissions,
  SuperAdminEmployee,
  Department,
  Position,
  EmployeeCreateData,
  EmployeeUpdateData,
  Asset,
  AssetAssignmentHistory,
  AssetMaintenance,
  AssetInventoryCheck,
  AssetInventoryCheckResult,
  AssetStats,
  CompanyConfig,
  ShiftConfig,
  HolidayConfig,
  CurrentCompanyConfig,
  AttendanceRuleConfig,
  AttendanceRuleHistory,
  LeavePolicyConfig,
  AttendanceRuleEngineRequest,
  AttendanceRuleEngineResponse,
  BirthdayWish,
  CompanyUnit,
} from './types';

// Re-export all APIs
export { authAPI } from './auth.api';
export { internalChatAPI } from './internal-chat.api';
export type { InternalChatUser, InternalChatMessage, InternalConversation, InternalReactionType, ChatBootstrap } from './internal-chat.api';
export { dashboardAPI, publicStatsAPI, attendanceAppDownloadAPI } from './system.api';
export type { AttendanceAppDownloadConfig } from './system.api';
export type { EmployeeDependent, EmployeeDependentPayload } from './hrm.api';
export type { EmployeeStatusLogEntry } from './hrm.api';
export {
  employeesAPI,
  departmentsAPI,
  sectionsAPI,
  positionsAPI,
  sendAccountEmailsAPI,
  birthdayWishesAPI,
  companyUnitsAPI,
  employeeDependentsAPI,
} from './hrm.api';
export {
  assetsAPI,
  assetAssignmentsAPI,
  assetMaintenanceAPI,
  assetInventoryChecksAPI,
} from './assets.api';
export { companyConfigAPI, hrmAPI, attendanceRuleAPI } from './company-config.api';

// Default export with all APIs
import { authAPI } from './auth.api';
import { dashboardAPI } from './system.api';
import {
  employeesAPI,
  departmentsAPI,
  sectionsAPI,
  positionsAPI,
  sendAccountEmailsAPI,
  birthdayWishesAPI,
  companyUnitsAPI,
  employeeDependentsAPI,
} from './hrm.api';
import {
  assetsAPI,
  assetAssignmentsAPI,
  assetMaintenanceAPI,
  assetInventoryChecksAPI,
} from './assets.api';
import { companyConfigAPI, hrmAPI, attendanceRuleAPI } from './company-config.api';

export default {
  auth: authAPI,
  employees: employeesAPI,
  departments: departmentsAPI,
  sections: sectionsAPI,
  positions: positionsAPI,
  assets: assetsAPI,
  assetAssignments: assetAssignmentsAPI,
  assetMaintenance: assetMaintenanceAPI,
  assetInventoryChecks: assetInventoryChecksAPI,
  hrm: hrmAPI,
  attendanceRule: attendanceRuleAPI,
  birthdayWishes: birthdayWishesAPI,
  sendAccountEmails: sendAccountEmailsAPI,
  dashboard: dashboardAPI,
  companyConfig: companyConfigAPI,
  companyUnits: companyUnitsAPI,
};
