import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const FacebookCallback: React.FC = () => {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorReason = searchParams.get('error_reason');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      // Handle error
      const errorMessage =
        errorDescription || errorReason || 'Authorization failed';
      window.opener?.postMessage(
        {
          type: 'FACEBOOK_AUTH_ERROR',
          error: errorMessage,
        },
        window.location.origin
      );
    } else if (code) {
      // Handle success
      window.opener?.postMessage(
        {
          type: 'FACEBOOK_AUTH_SUCCESS',
          code: code,
        },
        window.location.origin
      );
    } else {
      // No code or error - user probably closed the window
      window.opener?.postMessage(
        {
          type: 'FACEBOOK_AUTH_ERROR',
          error: 'Authorization was cancelled',
        },
        window.location.origin
      );
    }

    // Close the popup window
    window.close();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">
          Đang hoàn thành kết nối Facebook
        </h2>
        <p className="text-gray-600">
          Vui lòng chờ trong khi chúng tôi hoàn thành quyền truy cập...
        </p>
      </div>
    </div>
  );
};

export default FacebookCallback;
