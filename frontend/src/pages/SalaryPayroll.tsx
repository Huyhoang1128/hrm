import React from 'react';
import SalaryManagement from './SalaryManagement';

const SalaryPayroll: React.FC = () => {
  return <SalaryManagement defaultTab="view" lockTab />;
};

export default SalaryPayroll;
