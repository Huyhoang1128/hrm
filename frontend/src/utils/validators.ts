import * as yup from 'yup';

export const loginValidationSchema = yup.object({
  username: yup.string().required('Username is required'),
  password: yup.string().required('Password is required'),
});

export const chatbotValidationSchema = yup.object({
  name: yup.string().required('Name is required').min(1).max(255),
  instructions: yup
    .string()
    .required('Instructions are required')
    .min(10)
    .max(10000),
  avatar_url: yup.string().url('Must be a valid URL').nullable(),
  status: yup
    .string()
    .oneOf(['active', 'inactive'])
    .required('Status is required'),
});

export const userValidationSchema = yup.object({
  username: yup.string().required('Username is required').min(3).max(50),
  email: yup
    .string()
    .email('Must be a valid email')
    .required('Email is required'),
  password: yup
    .string()
    .required('Password is required')
    .min(8, 'Password must be at least 8 characters'),
  full_name: yup.string().nullable(),
});

export const apiKeyValidationSchema = yup.object({
  key_name: yup.string().required('Key name is required').min(1).max(100),
});

export const documentUploadValidationSchema = yup.object({
  file: yup
    .mixed()
    .required('File is required')
    .test('fileSize', 'File size must be less than 10MB', (value: any) => {
      if (!value) return false;
      return value.size <= 10 * 1024 * 1024; // 10MB
    })
    .test(
      'fileType',
      'Only PDF, DOC, DOCX, TXT files are allowed',
      (value: any) => {
        if (!value) return false;
        const allowedTypes = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ];
        return allowedTypes.includes(value.type);
      }
    ),
});
