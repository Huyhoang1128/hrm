import React, { useEffect, useState } from 'react';
import type { Department } from '../utils/api';
import { salaryService } from '../services/salary.service';
import BonusPredictionTab from './BonusPredictionTab';
import { ArrowPathIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';

const SalaryBonusPrediction: React.FC = () => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDepartments = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await salaryService.listSalaryDepartments();
        setDepartments(data as Department[]);
      } catch {
        setError('Không tải được danh sách phòng ban.');
      } finally {
        setLoading(false);
      }
    };
    void loadDepartments();
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-8">
        <div className="flex items-center justify-center text-sm text-gray-500">
          <ArrowPathIcon className="h-5 w-5 animate-spin mr-2" />
          Đang tải dữ liệu...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-8">
        <div className="flex items-center justify-center text-sm text-red-600">
          <ExclamationCircleIcon className="h-5 w-5 mr-2" />
          {error}
        </div>
      </div>
    );
  }

  return <BonusPredictionTab departments={departments} />;
};

export default SalaryBonusPrediction;
