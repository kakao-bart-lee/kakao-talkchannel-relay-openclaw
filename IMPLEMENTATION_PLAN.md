# Kakao Channel Relay Server 구현 계획

## 개요
카카오 채널 웹훅을 수신하고 OpenClaw 설치로 메시지를 전달하는 공개 중계 서버 구현

## 기술 스택
- **런타임/프레임워크**: Hono + Bun
- **데이터베이스/ORM**: PostgreSQL + Drizzle
- **배포**: GCP Cloud Run

---

## 프로젝트 구조

```
relay-server/
├── src/
│   ├── index.ts                    # 애플리케이션 진입점
│   ├── app.ts                      # Hono 앱 설정
│   ├── config/
│   │   ├── env.ts                  # 환경 변수 검증 (Zod)
│   │   └── constants.ts            # 상수 정의
│   ├── db/
│   │   ├── index.ts                # DB 클라이언트 초기화
│   │   ├── schema.ts               # Drizzle 스키마
│   │   └── migrate.ts              # 마이그레이션 러너
│   ├── routes/
│   │   ├── kakao.ts                # POST /kakao/webhook
│   │   ├── openclaw.ts             # GET/POST /openclaw/*
│   │   └── health.ts               # GET /health
│   ├── services/
│   │   ├── account.service.ts      # 계정 관리
│   │   ├── message.service.ts      # 메시지 큐 처리
│   │   ├── kakao.service.ts        # 카카오 API 호출
│   │   └── polling.service.ts      # 롱폴링 로직
│   ├── middleware/
│   │   ├── auth.ts                 # relayToken 인증
│   │   ├── kakao-signature.ts      # 카카오 서명 검증
│   │   ├── rate-limit.ts           # 계정별 속도 제한
│   │   ├── error-handler.ts        # 에러 핸들링
│   │   └── logger.ts               # 요청 로깅
│   ├── types/
│   │   ├── kakao.ts                # 카카오 웹훅 타입
│   │   └── openclaw.ts             # OpenClaw API 타입
│   ├── utils/
│   │   ├── crypto.ts               # 토큰 생성, HMAC 검증
│   │   ├── normalize.ts            # 페이로드 정규화
│   │   └── logger.ts               # 구조화된 로거
│   └── jobs/
│       └── cleanup.ts              # TTL 만료 백그라운드 작업
├── drizzle/
│   └── migrations/                 # SQL 마이그레이션 파일
├── tests/
│   ├── unit/                       # 단위 테스트
│   └── integration/                # 통합 테스트
├── Dockerfile
├── cloudbuild.yaml
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── biome.json
```

---

## 데이터베이스 스키마

### accounts
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 계정 ID |
| openclaw_user_id | TEXT | OpenClaw 사용자 ID |
| relay_token | TEXT | 중계 토큰 (일반) |
| relay_token_hash | TEXT | 토큰 해시 (인덱스용) |
| mode | ENUM | 'direct' \| 'relay' |
| rate_limit_per_minute | INT | 분당 요청 제한 (기본 60) |
| created_at, updated_at | TIMESTAMP | 타임스탬프 |

### mappings
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 매핑 ID |
| kakao_user_key | TEXT | 카카오 사용자 키 |
| account_id | UUID (FK) | 계정 참조 |
| last_seen_at | TIMESTAMP | 마지막 활동 시간 |

### inbound_messages
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 메시지 ID |
| account_id | UUID (FK) | 계정 참조 |
| kakao_payload | JSONB | 원본 카카오 페이로드 |
| normalized_message | JSONB | 정규화된 메시지 |
| callback_url | TEXT | 콜백 URL |
| callback_expires_at | TIMESTAMP | 콜백 만료 시간 |
| status | ENUM | 'queued' \| 'delivered' \| 'expired' |
| created_at, delivered_at | TIMESTAMP | 타임스탬프 |

### outbound_messages
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 메시지 ID |
| account_id | UUID (FK) | 계정 참조 |
| inbound_message_id | UUID (FK) | 인바운드 메시지 참조 |
| kakao_target | JSONB | 응답 대상 정보 |
| response_payload | JSONB | 카카오 v2.0 응답 |
| status | ENUM | 'pending' \| 'sent' \| 'failed' |
| error_message | TEXT | 에러 메시지 (실패 시) |
| created_at, sent_at | TIMESTAMP | 타임스탬프 |

---

## API 엔드포인트

### 1. POST /kakao/webhook
카카오 채널에서 사용자 메시지 수신

**처리 흐름**:
1. 카카오 서명 검증 (설정된 경우)
2. 페이로드 파싱 및 검증 (Zod)
3. 계정 확인 및 매핑 업데이트
4. 메시지 큐에 저장 (callbackUrl 포함)
5. 즉시 응답: `{ "version": "2.0", "useCallback": true }`

**요청 예시**:
```json
{
  "userRequest": {
    "user": { "id": "kakao-user-123" },
    "utterance": "안녕하세요",
    "callbackUrl": "https://bot-api.kakao.com/callback/..."
  },
  "bot": { "id": "bot-123", "name": "My Bot" }
}
```

### 2. GET /openclaw/messages
OpenClaw에서 대기 중인 메시지 조회 (롱폴링 지원)

**쿼리 파라미터**:
- `token` (필수): relayToken
- `since` (선택): ISO 8601 날짜, 이후 메시지만 조회
- `limit` (선택): 최대 메시지 수 (기본 20, 최대 100)
- `wait` (선택): 롱폴링 대기 시간 (초, 최대 30)

**응답 예시**:
```json
{
  "messages": [
    {
      "id": "uuid",
      "payload": { "text": "안녕하세요", ... },
      "callbackUrl": "https://bot-api.kakao.com/callback/...",
      "callbackExpiresAt": "2024-01-31T10:01:00Z",
      "createdAt": "2024-01-31T10:00:00Z"
    }
  ],
  "hasMore": false
}
```

### 3. POST /openclaw/reply
OpenClaw에서 카카오로 응답 전송

**요청 바디**:
```json
{
  "token": "relay-token",
  "messageId": "inbound-message-uuid",
  "response": {
    "version": "2.0",
    "template": {
      "outputs": [
        { "simpleText": { "text": "안녕하세요!" } }
      ]
    }
  }
}
```

**응답**:
```json
{ "success": true, "outboundMessageId": "uuid" }
```

### 4. GET /health
헬스체크 엔드포인트

**응답**:
```json
{
  "status": "healthy",
  "checks": { "database": "ok" },
  "timestamp": "2024-01-31T10:00:00Z"
}
```

---

## 핵심 기능 상세

### 콜백 플로우 (useCallback)
카카오 스킬 타임아웃(5초) 내에 AI 응답을 생성할 수 없으므로 콜백 방식 사용:

```
[카카오 채널] --webhook--> [중계 서버] --즉시 useCallback 응답-->
                              |
                              v (메시지 저장)
                              |
[OpenClaw] <--polling-- [중계 서버] (메시지 조회)
                              |
[OpenClaw] --reply--> [중계 서버] --callback--> [카카오 봇 API]
```

**타임라인 제약**:
- 스킬 타임아웃: 5초 (즉시 useCallback 응답 필요)
- 콜백 URL 유효 시간: 1분 (55초 내 응답 필요)

### 롱폴링 구현
```typescript
async function waitForMessages(accountId: string, timeoutSeconds: number) {
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    const messages = await getQueuedMessages(accountId);
    if (messages.length > 0) return messages;
    await sleep(500); // 500ms 간격 체크
  }
  return []; // 타임아웃
}
```

### TTL 관리
| 항목 | TTL | 설명 |
|------|-----|------|
| 인바운드 메시지 | 15분 | QUEUE_TTL_SECONDS |
| 콜백 URL | 55초 | CALLBACK_TTL_SECONDS |

**만료 처리**:
- 1분 간격 백그라운드 작업
- 만료된 메시지 상태를 'expired'로 변경

### 속도 제한
- 계정별 분당 요청 제한 (기본 60회)
- 인메모리 슬라이딩 윈도우
- 응답 헤더: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## 환경 변수

```bash
# 서버 설정
PORT=8080
NODE_ENV=production

# 데이터베이스
DATABASE_URL=postgresql://user:password@host:5432/kakao_relay

# 중계 설정
RELAY_BASE_URL=https://relay.example.com
KAKAO_SIGNATURE_SECRET=optional-kakao-secret

# 큐/폴링 설정
QUEUE_TTL_SECONDS=900          # 15분
MAX_POLL_WAIT_SECONDS=30       # 롱폴링 최대 대기
CALLBACK_TTL_SECONDS=55        # 콜백 URL TTL

# 속도 제한
DEFAULT_RATE_LIMIT_PER_MINUTE=60

# 로깅
LOG_LEVEL=info
```

---

## 구현 순서

### Phase 0: 사전 작업 ✅ 완료
- [x] Agent 파일 symlink (4개)
  ```
  .claude/agents/
  ├── architect.md -> /Users/joy/workspace/everything-claude-code/agents/architect.md
  ├── code-reviewer.md -> /Users/joy/workspace/everything-claude-code/agents/code-reviewer.md
  ├── security-reviewer.md -> /Users/joy/workspace/everything-claude-code/agents/security-reviewer.md
  └── tdd-guide.md -> /Users/joy/workspace/everything-claude-code/agents/tdd-guide.md
  ```
- [x] Skill 디렉토리 symlink (4개)
  ```
  .claude/skills/
  ├── backend-patterns -> /Users/joy/workspace/everything-claude-code/skills/backend-patterns
  ├── postgres-patterns -> /Users/joy/workspace/everything-claude-code/skills/postgres-patterns
  ├── security-review -> /Users/joy/workspace/everything-claude-code/skills/security-review
  └── tdd-workflow -> /Users/joy/workspace/everything-claude-code/skills/tdd-workflow
  ```
- [x] `.gitignore`에 `.claude/` 추가

### Phase 1: 기반 설정 (1-2일)
- [ ] Bun 프로젝트 초기화 (`bun init`)
- [ ] 의존성 설치: hono, @hono/zod-validator, drizzle-orm, pg, zod
- [ ] TypeScript, Biome 설정
- [ ] 환경 변수 설정 (src/config/env.ts)
- [ ] Drizzle 스키마 정의 (src/db/schema.ts)
- [ ] 초기 마이그레이션 생성 및 실행

### Phase 2: 핵심 서비스 (2-3일)
- [ ] account.service.ts - 토큰 해싱, 계정 조회, 매핑 관리
- [ ] message.service.ts - 인바운드/아웃바운드 CRUD, 상태 관리
- [ ] kakao.service.ts - 콜백 URL로 응답 전송
- [ ] polling.service.ts - 롱폴링 로직

### Phase 3: API 엔드포인트 (3-4일)
- [ ] GET /health
- [ ] POST /kakao/webhook
- [ ] GET /openclaw/messages
- [ ] POST /openclaw/reply

### Phase 4: 미들웨어 및 보안 (4-5일)
- [ ] auth.ts - relayToken 인증
- [ ] kakao-signature.ts - 서명 검증
- [ ] rate-limit.ts - 속도 제한
- [ ] error-handler.ts - 에러 핸들링
- [ ] logger.ts - 구조화된 로깅

### Phase 5: 백그라운드 작업 (5일)
- [ ] cleanup.ts - TTL 만료 메시지 정리

### Phase 6: 테스트 (5-6일)
- [ ] 테스트 DB 설정
- [ ] 서비스 단위 테스트
- [ ] 엔드포인트 통합 테스트

### Phase 7: 배포 (6-7일)
- [ ] Dockerfile 작성
- [ ] cloudbuild.yaml 설정
- [ ] Cloud Run 서비스 구성
- [ ] Secret Manager 설정
- [ ] 도메인 및 SSL 설정

---

## 검증 방법

### 로컬 테스트
```bash
# 서버 실행
bun run dev

# 헬스체크
curl http://localhost:8080/health

# 웹훅 테스트
curl -X POST http://localhost:8080/kakao/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "userRequest": {
      "user": { "id": "test-user" },
      "utterance": "안녕하세요",
      "callbackUrl": "https://example.com/callback"
    },
    "bot": { "id": "bot-1" }
  }'

# 메시지 폴링 테스트
curl "http://localhost:8080/openclaw/messages?token=YOUR_TOKEN&limit=10&wait=5"

# 응답 전송 테스트
curl -X POST http://localhost:8080/openclaw/reply \
  -H "Content-Type: application/json" \
  -d '{
    "token": "YOUR_TOKEN",
    "messageId": "MESSAGE_UUID",
    "response": {
      "version": "2.0",
      "template": {
        "outputs": [{ "simpleText": { "text": "응답입니다" } }]
      }
    }
  }'
```

### 통합 테스트
```bash
bun test
```

### 프로덕션 테스트
1. Cloud Run 배포 후 로그 확인
2. 카카오 채널 관리자센터에서 스킬 URL 설정
3. 실제 카카오톡에서 메시지 전송 테스트
4. OpenClaw 연동 E2E 테스트

---

## 보안 고려사항

1. **토큰 저장**: 해시된 토큰만 DB에 저장, 평문 로깅 금지
2. **서명 검증**: KAKAO_SIGNATURE_SECRET 설정 시 HMAC 검증
3. **속도 제한**: 계정별 요청 제한으로 남용 방지
4. **입력 검증**: 모든 API 입력에 Zod 스키마 적용
5. **SQL 인젝션 방지**: Drizzle ORM 파라미터화 쿼리
6. **타이밍 공격 방지**: crypto.timingSafeEqual 사용
7. **HTTPS 강제**: Cloud Run 자동 TLS
8. **시크릿 관리**: GCP Secret Manager 사용

---

## 참고 문서

- [카카오 스킬 개발 가이드](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide)
- [AI 챗봇 콜백 가이드](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/ai_chatbot_callback_guide)
- [응답 타입별 JSON 포맷](https://kakaobusiness.gitbook.io/main/tool/chatbot/skill_guide/answer_json_format)
- [Hono 공식 문서](https://hono.dev)
- [Drizzle ORM 문서](https://orm.drizzle.team)
- [Bun 공식 문서](https://bun.sh)
