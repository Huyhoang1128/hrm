import React from 'react';
import SalaryManagement from './SalaryManagement';

const SalaryEmployeeConfig: React.FC = () => {
  return <SalaryManagement defaultTab="config" lockTab />;
};

export default SalaryEmployeeConfig;
