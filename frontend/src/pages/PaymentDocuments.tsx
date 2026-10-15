import React from 'react';
import PaymentDocumentsTab from '../components/PaymentDocuments/PaymentDocumentsTab';

// Phiếu đề nghị thanh toán / đề xuất mua hàng / đề nghị tạm ứng — chỉ Admin/HCNS.
const PaymentDocuments: React.FC = () => (
  <div className="space-y-4">
    <div>
      <h1 className="text-xl font-bold text-gray-900">Thanh toán &amp; mua hàng</h1>
      <p className="text-sm text-gray-500">
        Lưu trữ phiếu đề nghị thanh toán, đề xuất mua hàng, đề nghị tạm ứng và rà soát hằng tháng.
      </p>
    </div>
    <PaymentDocumentsTab />
  </div>
);

export default PaymentDocuments;
