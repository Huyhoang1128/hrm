# JWT API Implementation for HRM Backend

## Overview

This Django project has been successfully integrated with Django REST Framework and JWT (JSON Web Token) authentication. The implementation provides secure API endpoints for user authentication and management.

## Installed Packages

- `djangorestframework` - Django REST Framework for building APIs
- `djangorestframework-simplejwt` - JWT authentication for Django REST Framework

## Configuration

### Settings (config/settings.py)

1. **INSTALLED_APPS**: Added `'rest_framework'` and `'rest_framework_simplejwt'`
2. **REST_FRAMEWORK**: Configured with JWT authentication and default permissions
3. **SIMPLE_JWT**: Custom JWT settings including token lifetimes and algorithms

### JWT Settings

- **Access Token Lifetime**: 60 minutes
- **Refresh Token Lifetime**: 1 day
- **Algorithm**: HS256
- **Token Type**: Bearer

## API Endpoints

### User API Endpoints (Tất cả trong `/api/users/`)

| Endpoint | Method | Description | Authentication Required |
|----------|--------|-------------|-------------------------|
| `/api/users/token/` | POST | Obtain JWT token pair | No |
| `/api/users/token/refresh/` | POST | Refresh access token | No |
| `/api/users/token/verify/` | POST | Verify token validity | No |
| `/api/users/register/` | POST | Register new user | No |
| `/api/users/profile/` | GET | Get user profile | Yes |
| `/api/users/info/` | GET | Public API information | No |

### Admin & Browsable API

| Endpoint | Description |
|----------|-------------|
| `/admin/` | Django admin interface |
| `/api-auth/` | REST Framework browsable API login |

## Usage Examples

### 1. User Registration

```bash
curl -X POST http://127.0.0.1:8000/api/users/register/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newuser",
    "email": "newuser@example.com",
    "password": "securepassword123",
    "first_name": "New",
    "last_name": "User"
  }'
```

### 2. Obtain JWT Tokens

```bash
curl -X POST http://127.0.0.1:8000/api/users/token/ \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin1",
    "password": "yourpassword"
  }'
```

Response:
```json
{
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "access": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

### 3. Access Protected Endpoint

```bash
curl -X GET http://127.0.0.1:8000/api/users/profile/ \
  -H "Authorization: Bearer your_access_token_here"
```

### 4. Refresh Token

```bash
curl -X POST http://127.0.0.1:8000/api/users/token/refresh/ \
  -H "Content-Type: application/json" \
  -d '{
    "refresh": "your_refresh_token_here"
  }'
```

## Project Structure

```
backend/
├── config/
│   ├── settings.py          # JWT and REST Framework configuration
│   ├── urls.py              # API endpoints configuration
│   └── ...
├── users/                   # Dedicated user management app
│   ├── views.py             # User API views
│   ├── urls.py              # User app URLs
│   └── ...
├── manage.py
└── JWT_API_DOCUMENTATION.md
```

## Testing the Implementation

1. **Start the development server**:
   ```bash
   python manage.py runserver
   ```

2. **Access the API**:
   - Public info: http://127.0.0.1:8000/api/users/info/
   - Admin: http://127.0.0.1:8000/admin/
   - API Auth: http://127.0.0.1:8000/api-auth/
   - JWT Token: http://127.0.0.1:8000/api/users/token/

3. **Test authentication flow**:
   - Register a new user
   - Obtain JWT tokens
   - Access protected endpoints with the token

## Security Features

- JWT tokens with configurable expiration
- Password validation
- User registration with validation
- Protected endpoints requiring authentication
- Token refresh mechanism

## Next Steps

1. Create custom user models if needed
2. Add more API endpoints for your specific business logic
3. Implement role-based permissions
4. Add API documentation with tools like Swagger/OpenAPI
5. Set up production deployment with proper security measures

## Troubleshooting

- Ensure all packages are installed in the correct environment
- Check that migrations are applied
- Verify the conda environment is activated
- Test endpoints with tools like curl, Postman, or the browsable API
