# Frontend Enhancement Handoff Document

## Project Context

카카오톡 채널 메시지를 OpenClaw로 연결하는 릴레이 서버의 Frontend 개선 작업입니다.

- **Repository**: relay-server
- **Branch**: `feature/portal-enhancement`
- **Worktree Path**: `/Users/joy/workspace/openclaw-anal/repos/relay-server-portal`

## Current State

### Existing Frontend Structure

```
portal/src/
├── App.tsx                    # Router (login, dashboard)
├── main.tsx                   # Entry point
├── index.css                  # Tailwind CSS
├── pages/
│   ├── AuthPage.tsx           # Login/Signup (완료)
│   └── DashboardPage.tsx      # Dashboard with pairing code (완료)
├── components/ui/             # shadcn/ui components
│   ├── button.tsx
│   ├── input.tsx
│   ├── card.tsx
│   ├── badge.tsx
│   └── tabs.tsx
└── lib/
    ├── api.ts                 # API client
    └── utils.ts               # Utilities (cn)
```

### Tech Stack

- **Framework**: React 18 + TypeScript
- **Routing**: react-router-dom v6
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui
- **Build**: Bun (HTML imports)

## User Roles

| Role | Auth Method | API Path | Frontend Path |
|------|-------------|----------|---------------|
| **Portal User** | Email + Password | `/portal/api/*` | `/portal/*` |
| **Admin** | Environment Password | `/admin/api/*` | `/admin/*` |

## Task List

### Backend Tasks (To be implemented separately)

| # | Task | API Endpoint | Priority |
|---|------|--------------|----------|
| 1 | Portal API 토큰 조회 | `GET /portal/api/token` | 🔴 필수 |
| 2 | Portal 연결 해제 | `POST /portal/api/connections/:key/unpair` | 🔴 필수 |
| 3 | Portal 비밀번호 변경 | `PATCH /portal/api/password` | 🔴 필수 |
| 4 | Portal API 토큰 재발급 | `POST /portal/api/token/regenerate` | 🟡 권장 |
| 5 | Portal 계정 탈퇴 | `DELETE /portal/api/account` | 🟡 권장 |
| 6 | Portal 연결 차단/해제 | `PATCH /portal/api/connections/:key/block` | 🟢 선택 |
| 7 | Portal 메시지 히스토리 | `GET /portal/api/messages` | 🟢 선택 |
| 8 | Admin 사용자 목록 | `GET /admin/api/users` | 🔴 필수 |
| 9 | Admin 사용자 상세 | `GET /admin/api/users/:id` | 🔴 필수 |
| 10 | Admin 사용자 관리 | `PATCH/DELETE /admin/api/users/:id` | 🟡 권장 |
| 11 | Portal 비밀번호 재설정 | `POST /portal/api/password/forgot,reset` | 🟡 권장 |

### Frontend Tasks

#### Portal (일반 사용자)

| # | Task | Status | Description |
|---|------|--------|-------------|
| 16 | 네비게이션 및 레이아웃 | ⬜ TODO | 공통 레이아웃, 상단 네비게이션 |
| 12 | 연결 관리 개선 | ⬜ TODO | unpair, block 버튼, 필터링 |
| 13 | API 토큰 페이지 | ⬜ TODO | /settings/token |
| 14 | 설정 페이지 | ⬜ TODO | /settings (비밀번호 변경, 탈퇴) |
| 15 | 메시지 히스토리 | ⬜ TODO | /messages |

#### Admin (관리자)

| # | Task | Status | Description |
|---|------|--------|-------------|
| 23 | 네비게이션 및 레이아웃 | ⬜ TODO | 사이드바 레이아웃 |
| 17 | 로그인 페이지 | ⬜ TODO | /admin/login |
| 18 | 대시보드 | ⬜ TODO | /admin (통계) |
| 19 | 계정 관리 | ⬜ TODO | /admin/accounts |
| 20 | 사용자 관리 | ⬜ TODO | /admin/users |
| 21 | 연결 관리 | ⬜ TODO | /admin/mappings |
| 22 | 메시지 모니터링 | ⬜ TODO | /admin/messages |

## Recommended Work Order

### Phase 1: Portal Enhancement
1. **#16 네비게이션 및 레이아웃** - 공통 Layout 컴포넌트 생성
2. **#12 연결 관리 개선** - DashboardPage 수정
3. **#13 API 토큰 페이지** - 새 페이지 생성
4. **#14 설정 페이지** - 새 페이지 생성

### Phase 2: Admin Dashboard
1. **#23 Admin 레이아웃** - AdminLayout 컴포넌트
2. **#17 로그인 페이지** - AdminLoginPage
3. **#18 대시보드** - AdminDashboardPage
4. **#19 계정 관리** - AdminAccountsPage
5. **#21 연결 관리** - AdminMappingsPage
6. **#22 메시지 모니터링** - AdminMessagesPage
7. **#20 사용자 관리** - AdminUsersPage

### Phase 3: Additional Features
1. **#15 메시지 히스토리** - Portal 사용자용

## API Specifications (Assumed)

### Portal APIs

```typescript
// GET /portal/api/token
interface TokenResponse {
  token: string;
  createdAt: string;
}

// POST /portal/api/token/regenerate
interface RegenerateTokenResponse {
  token: string;
  createdAt: string;
}

// POST /portal/api/connections/:key/unpair
interface UnpairResponse {
  success: boolean;
}

// PATCH /portal/api/connections/:key/block
interface BlockResponse {
  success: boolean;
  state: 'blocked' | 'paired';
}

// PATCH /portal/api/password
interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// DELETE /portal/api/account
interface DeleteAccountRequest {
  password: string;
}

// GET /portal/api/messages?type=inbound|outbound&limit=20&offset=0
interface MessagesResponse {
  messages: Message[];
  total: number;
  hasMore: boolean;
}
```

### Admin APIs

```typescript
// GET /admin/api/users?limit=50&offset=0
interface UsersResponse {
  data: PortalUser[];
  pagination: { total: number; limit: number; offset: number };
}

// GET /admin/api/users/:id
interface UserDetailResponse {
  id: string;
  email: string;
  accountId: string;
  createdAt: string;
  lastLoginAt: string;
  account: Account;
  connectionCount: number;
}

// PATCH /admin/api/users/:id
interface UpdateUserRequest {
  isActive?: boolean;
}

// DELETE /admin/api/users/:id
// Returns 204 No Content
```

## Existing Backend APIs (Already Implemented)

### Portal APIs
- `POST /portal/api/signup` - 회원가입
- `POST /portal/api/login` - 로그인
- `POST /portal/api/logout` - 로그아웃
- `GET /portal/api/me` - 내 정보
- `POST /portal/api/pairing/generate` - 페어링 코드 생성
- `GET /portal/api/connections` - 연결 목록

### Admin APIs
- `POST /admin/api/login` - 로그인
- `POST /admin/api/logout` - 로그아웃
- `GET /admin/api/stats` - 시스템 통계
- `GET /admin/api/accounts` - 계정 목록
- `POST /admin/api/accounts` - 계정 생성
- `GET /admin/api/accounts/:id` - 계정 상세
- `PATCH /admin/api/accounts/:id` - 계정 수정
- `DELETE /admin/api/accounts/:id` - 계정 삭제
- `POST /admin/api/accounts/:id/regenerate-token` - 토큰 재발급
- `GET /admin/api/mappings` - 연결 목록
- `DELETE /admin/api/mappings/:id` - 연결 삭제
- `GET /admin/api/messages/inbound` - 수신 메시지
- `GET /admin/api/messages/outbound` - 발신 메시지

## File Structure to Create

```
portal/src/
├── App.tsx                         # Update routes
├── components/
│   ├── ui/                         # Existing shadcn components
│   ├── Layout.tsx                  # Portal layout with nav
│   └── AdminLayout.tsx             # Admin layout with sidebar
├── pages/
│   ├── AuthPage.tsx                # Existing
│   ├── DashboardPage.tsx           # Update with unpair/block
│   ├── SettingsPage.tsx            # NEW
│   ├── TokenPage.tsx               # NEW
│   ├── MessagesPage.tsx            # NEW
│   └── admin/
│       ├── AdminLoginPage.tsx      # NEW
│       ├── AdminDashboardPage.tsx  # NEW
│       ├── AdminAccountsPage.tsx   # NEW
│       ├── AdminUsersPage.tsx      # NEW
│       ├── AdminMappingsPage.tsx   # NEW
│       └── AdminMessagesPage.tsx   # NEW
└── lib/
    ├── api.ts                      # Update with new endpoints
    └── admin-api.ts                # NEW - Admin API client
```

## Development Commands

```bash
# Navigate to worktree
cd /Users/joy/workspace/openclaw-anal/repos/relay-server-portal

# Install dependencies (if needed)
bun install

# Start development server
bun run dev

# Or start with backend
cd /Users/joy/workspace/openclaw-anal/repos/relay-server
bun run dev
```

## Notes

1. **Backend APIs are assumed to exist** - Frontend 작업 시 API가 없으면 mock 데이터 사용
2. **shadcn/ui components** - 필요한 컴포넌트는 직접 추가 (dialog, dropdown-menu, table 등)
3. **Tailwind CSS v4** - 최신 문법 사용
4. **Korean UI** - 대부분의 UI 텍스트는 한국어로 작성

## Getting Started

1. Task #16 (Portal 레이아웃)부터 시작
2. `Layout.tsx` 컴포넌트 생성
3. `App.tsx`에 라우트 추가
4. 각 페이지 순차적으로 구현

---

*Last Updated: 2026-02-01*
*Created by: Claude Opus 4.5*
