import { managementApi } from '../utils/api';

export const generateAttendanceExplanationMarkdown = async (id: number): Promise<string> => {
  const response = await managementApi.get(`/api-hrm/attendance-explanations/generate_markdown/`, {
    params: { id }
  });
  return response.data.markdown || response.data;
};
