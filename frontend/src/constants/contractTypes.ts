/** Nhóm loại hợp đồng của nhân viên (contract_type) — khớp employee.models phía backend. */
export const PROBATION_CONTRACT_TYPES = ['PROBATION', 'PROBATION_1M', 'PROBATION_2M'];
export const NON_OFFICIAL_CONTRACT_TYPES = [...PROBATION_CONTRACT_TYPES, 'INTERN', 'COLLABORATOR'];
export const OFFICIAL_LABOR_CONTRACT_TYPES = ['SIX_MONTH', 'ONE_YEAR', 'TWO_YEAR', 'THREE_YEAR', 'INDEFINITE'];

export const isProbationContract = (contractType?: string | null) =>
  !!contractType && PROBATION_CONTRACT_TYPES.includes(contractType);
