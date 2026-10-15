/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MANAGEMENT_API_URL?: string;
  readonly VITE_CHECKIN_APP_API_URL?: string;
  readonly VITE_CHECKIN_APP_API_KEY?: string;
  readonly VITE_APP_NAME?: string;
  readonly VITE_COMPANY_NAME?: string;
  readonly VITE_COMPANY_LEGAL_NAME?: string;
  readonly VITE_HR_DEPARTMENT_LABEL?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_LOGO_URL?: string;
  readonly VITE_DEFAULT_PASSWORD_PREFIX?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
