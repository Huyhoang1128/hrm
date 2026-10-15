import { managementApi } from '../utils/api';

export interface DeptAttendanceViolationItem {
  ma_nhan_vien: string;
  ten_nhan_vien: string;
  phong_ban: string;
  chuc_danh: string;
  vi_tri: string;
  bac_si: string;
  tong_cong: number;
  tong_phat: number;
  so_lan_vi_pham: number;
  so_lan_di_muon: number;
  so_lan_ve_som: number;
  so_lan_quen_cham_cong: number;
  tong_phat_di_muon: number;
  tong_phat_ve_som: number;
}

export interface DeptAttendanceViolationResponse {
  department_id: number;
  department_name: string;
  year: number;
  month: number;
  total_employees: number;
  total_violations: number;
  data: DeptAttendanceViolationItem[];
}

export interface DeptAttendanceViolationParams {
  department_id: number;
  year: number;
  month: number;
}

const deptAttendanceViolationReportService = {
  async get(params: DeptAttendanceViolationParams): Promise<DeptAttendanceViolationResponse> {
    const response = await managementApi.get('/api-hrm/dept-attendance-violation-report/', { params });
    return response.data;
  },
};

export default deptAttendanceViolationReportService;
