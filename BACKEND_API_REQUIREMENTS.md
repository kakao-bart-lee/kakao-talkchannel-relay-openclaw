# Backend API 개발 요청사항

프론트엔드 개선 작업에서 호출하는 API 중 백엔드에서 아직 구현되지 않은 엔드포인트 목록입니다.

## Portal API (미구현)

### 1. 연결 관리

#### `POST /portal/api/connections/:conversationKey/unpair`
카카오톡 연결 해제

**Request:**
- Path Parameter: `conversationKey` (URL encoded)

**Response:**
```json
{
  "success": true
}
```

#### `PATCH /portal/api/connections/:conversationKey/block`
카카오톡 연결 차단/차단해제 토글

**Request:**
- Path Parameter: `conversationKey` (URL encoded)

**Response:**
```json
{
  "success": true,
  "state": "blocked" | "paired"
}
```

---

### 2. API 토큰 관리

#### `GET /portal/api/token`
현재 사용자의 API 토큰 조회

**Response:**
```json
{
  "token": "relay_xxxxxx",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

#### `POST /portal/api/token/regenerate`
API 토큰 재발급

**Response:**
```json
{
  "token": "relay_yyyyyy",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

---

### 3. 계정 설정

#### `PATCH /portal/api/password`
비밀번호 변경

**Request:**
```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
```

**Response:**
- `204 No Content` (성공)
- `401 Unauthorized` (현재 비밀번호 불일치)

#### `DELETE /portal/api/account`
계정 탈퇴

**Request:**
```json
{
  "password": "current-password"
}
```

**Response:**
- `204 No Content` (성공)
- `401 Unauthorized` (비밀번호 불일치)

---

### 4. 메시지 조회

#### `GET /portal/api/messages`
사용자의 메시지 히스토리 조회

**Query Parameters:**
- `type`: `inbound` | `outbound` (optional)
- `limit`: number (default: 20)
- `offset`: number (default: 0)

**Response:**
```json
{
  "messages": [
    {
      "id": "msg-id",
      "conversationKey": "conv-key",
      "direction": "inbound" | "outbound",
      "content": "메시지 내용",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 100,
  "hasMore": true
}
```

---

## Admin API (미구현)

### 사용자 관리

#### `GET /admin/api/users`
Portal 사용자 목록 조회

**Query Parameters:**
- `limit`: number (default: 50, max: 100)
- `offset`: number (default: 0)

**Response:**
```json
{
  "items": [
    {
      "id": "user-id",
      "email": "user@example.com",
      "accountId": "account-id",
      "createdAt": "2024-01-01T00:00:00Z",
      "lastLoginAt": "2024-01-01T00:00:00Z" | null,
      "isActive": true
    }
  ],
  "total": 100
}
```

#### `GET /admin/api/users/:id`
특정 사용자 조회

**Response:**
```json
{
  "id": "user-id",
  "email": "user@example.com",
  "accountId": "account-id",
  "createdAt": "2024-01-01T00:00:00Z",
  "lastLoginAt": "2024-01-01T00:00:00Z" | null,
  "isActive": true
}
```

#### `PATCH /admin/api/users/:id`
사용자 정보 수정 (활성/비활성 토글)

**Request:**
```json
{
  "isActive": false
}
```

**Response:**
```json
{
  "id": "user-id",
  "email": "user@example.com",
  "accountId": "account-id",
  "createdAt": "2024-01-01T00:00:00Z",
  "lastLoginAt": "2024-01-01T00:00:00Z" | null,
  "isActive": false
}
```

#### `DELETE /admin/api/users/:id`
사용자 삭제

**Response:**
```json
{
  "success": true
}
```

---

## 구현 우선순위

| 우선순위 | API | 이유 |
|---------|-----|------|
| **High** | `POST /portal/api/connections/:key/unpair` | 연결 해제는 필수 기능 |
| **High** | `GET /portal/api/token` | 토큰 페이지 필수 |
| **High** | `POST /portal/api/token/regenerate` | 토큰 재발급 필수 |
| **Medium** | `PATCH /portal/api/connections/:key/block` | 스팸 차단 기능 |
| **Medium** | `PATCH /portal/api/password` | 보안 기능 |
| **Medium** | `DELETE /portal/api/account` | GDPR/개인정보보호법 준수 |
| **Medium** | `GET /portal/api/messages` | 메시지 히스토리 확인 |
| **Low** | `GET /admin/api/users` | 관리자 전용 |
| **Low** | `PATCH /admin/api/users/:id` | 관리자 전용 |
| **Low** | `DELETE /admin/api/users/:id` | 관리자 전용 |

---

## 참고: 프론트엔드 파일 위치

- Portal API 클라이언트: `portal/src/lib/api.ts`
- Admin API 클라이언트: `admin/src/lib/api.ts`
- Portal 페이지: `portal/src/pages/`
- Admin 페이지: `admin/src/pages/`
