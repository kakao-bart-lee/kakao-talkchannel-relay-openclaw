# Go + SSE 릴레이 서버 재작성 Handoff 문서

## 프로젝트 개요

TypeScript/Bun/Hono 기반 릴레이 서버를 Go + SSE로 완전 재작성하는 프로젝트입니다.

- **소스 코드**: `/Users/joy/workspace/openclaw-anal/repos/relay-server` (TypeScript 원본)
- **대상 코드**: `/Users/joy/workspace/openclaw-anal/repos/relay-server-go` (Go 신규)
- **변경 이유**: Long-polling (500ms 간격 DB 체크) → SSE + Redis Pub/Sub (실시간 푸시)
- **배포 대상**: Fly.io

---

## 기술 스택

| 영역 | 라이브러리 |
|------|-----------|
| Router | `chi/v5` (net/http 호환) |
| Database | `sqlx` + `lib/pq` |
| Redis | `go-redis/v9` |
| Validation | `validator/v10` |
| Config | `caarlos0/env/v11` |
| Logging | `rs/zerolog` |

---

## 현재 진행 상황

### 완료된 작업

1. **디렉토리 구조 생성 완료**
   ```
   relay-server-go/
   ├── cmd/server/
   ├── internal/
   │   ├── config/
   │   ├── database/
   │   ├── handler/
   │   ├── middleware/
   │   ├── repository/
   │   ├── service/
   │   └── sse/
   ├── migrations/
   └── static/{admin,portal}/
   ```

2. **Go 모듈 초기화 완료**
   - `go mod init github.com/openclaw/relay-server-go`

3. **TypeScript 소스 코드 분석 완료** (아래 참조 섹션 참고)

### 남은 작업 (8 Phase)

| Phase | 상태 | 설명 |
|-------|------|------|
| 1 | 🟡 진행 중 | 프로젝트 스캐폴딩 (config, db, router, Dockerfile) |
| 2 | ⬜ 대기 | 데이터베이스 레이어 (models, repositories) |
| 3 | ⬜ 대기 | 미들웨어 (auth, rate-limit, kakao-signature, logger) |
| 4 | ⬜ 대기 | Kakao Webhook (/pair, /unpair, /status, /help) |
| 5 | ⬜ 대기 | SSE + Redis Broker (핵심) |
| 6 | ⬜ 대기 | OpenClaw API (/v1/events, /v1/reply, /v1/pairing, /v1/messages/ack) |
| 7 | ⬜ 대기 | Admin/Portal API + SPA 서빙 |
| 8 | ⬜ 대기 | Cleanup jobs, Graceful shutdown, fly.toml |

---

## 데이터베이스 스키마 (PostgreSQL)

기존 Drizzle ORM 스키마를 그대로 사용합니다. 마이그레이션 SQL은 기존 것 재사용.

### Enums
```sql
CREATE TYPE account_mode AS ENUM ('direct', 'relay');
CREATE TYPE pairing_state AS ENUM ('unpaired', 'pending', 'paired', 'blocked');
CREATE TYPE inbound_message_status AS ENUM ('queued', 'delivered', 'acked', 'expired');
CREATE TYPE outbound_message_status AS ENUM ('pending', 'sent', 'failed');
```

### Tables (7개)
1. **accounts** - relay 계정 (relay_token_hash로 인증)
2. **conversation_mappings** - Kakao 대화 ↔ account 매핑
3. **pairing_codes** - 페어링 코드 (XXXX-XXXX 형식)
4. **portal_users** - 포털 사용자 (email + password)
5. **portal_sessions** - 포털 세션 (token_hash)
6. **admin_sessions** - 관리자 세션 (token_hash)
7. **inbound_messages** - Kakao → OpenClaw 메시지
8. **outbound_messages** - OpenClaw → Kakao 메시지

---

## API 엔드포인트 매핑

### Kakao Webhook
| Method | Path | 설명 |
|--------|------|------|
| POST | `/kakao/webhook` | Kakao 웹훅 수신 (X-Kakao-Signature 검증) |

### OpenClaw API (Bearer 토큰 인증)
| Method | Path | 설명 |
|--------|------|------|
| GET | `/v1/events` | **SSE 스트림** (새로 추가 - 핵심!) |
| POST | `/v1/reply` | Kakao로 응답 전송 |
| POST | `/v1/pairing/generate` | 페어링 코드 생성 |
| GET | `/v1/pairing/list` | 페어링된 대화 목록 |
| POST | `/v1/pairing/unpair` | 페어링 해제 |
| POST | `/v1/messages/ack` | 메시지 확인 |

### Admin API (세션 쿠키 인증)
| Method | Path | 설명 |
|--------|------|------|
| POST | `/admin/api/login` | 로그인 (비밀번호) |
| POST | `/admin/api/logout` | 로그아웃 |
| GET | `/admin/api/stats` | 통계 |
| GET/POST/PATCH/DELETE | `/admin/api/accounts/*` | 계정 CRUD |
| GET/DELETE | `/admin/api/mappings/*` | 매핑 관리 |
| GET | `/admin/api/messages/*` | 메시지 조회 |

### Portal API (세션 쿠키 인증)
| Method | Path | 설명 |
|--------|------|------|
| POST | `/portal/api/signup` | 회원가입 |
| POST | `/portal/api/login` | 로그인 |
| POST | `/portal/api/logout` | 로그아웃 |
| GET | `/portal/api/me` | 내 정보 |
| POST | `/portal/api/pairing/generate` | 페어링 코드 생성 |
| GET | `/portal/api/connections` | 연결 목록 |

---

## 핵심 로직 참조 (TypeScript → Go 변환 필요)

### 1. 토큰 인증 (`src/middleware/auth.ts`)
```go
// Bearer 토큰 또는 ?token= 쿼리 파라미터에서 추출
// SHA-256 해시 후 accounts.relay_token_hash와 비교
```

### 2. Kakao 명령어 파싱 (`src/routes/kakao.ts:22-45`)
```go
// /pair XXXX-XXXX → 페어링
// /unpair → 연결 해제
// /status → 상태 확인
// /help → 도움말
```

### 3. Kakao Callback URL 검증 (`src/services/kakao.service.ts:8-17`)
```go
// HTTPS만 허용
// 허용 호스트: .kakao.com, .kakaocdn.net, .kakaoenterprise.com
```

### 4. 페어링 코드 생성 (`src/services/pairing.service.ts`)
```go
// 형식: XXXX-XXXX (A-Z, 2-9, I/O/1/0 제외)
// 최대 활성 코드: 5개/계정
// 기본 만료: 600초, 최대: 1800초
```

### 5. SSE Broker (새로 구현 - 계획 문서 참조)
```go
// Redis Pub/Sub: "messages:{accountID}" 채널
// 연결 시 queued 메시지 즉시 전송
// 30초마다 heartbeat (: ping\n\n)
```

---

## 환경 변수

```bash
PORT=8080
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

KAKAO_SIGNATURE_SECRET=      # 선택, Kakao 서명 검증
ADMIN_PASSWORD=              # 8자 이상
ADMIN_SESSION_SECRET=        # 32자 이상
PORTAL_SESSION_SECRET=       # 32자 이상

QUEUE_TTL_SECONDS=900        # 메시지 만료 시간
CALLBACK_TTL_SECONDS=55      # Kakao callback 만료
LOG_LEVEL=info
```

---

## 다음 단계 상세 (Phase 1 완료를 위해)

### 1. `internal/config/config.go` 작성
```go
package config

import "github.com/caarlos0/env/v11"

type Config struct {
    Port                int    `env:"PORT" envDefault:"8080"`
    DatabaseURL         string `env:"DATABASE_URL,required"`
    RedisURL            string `env:"REDIS_URL,required"`
    KakaoSignatureSecret string `env:"KAKAO_SIGNATURE_SECRET"`
    AdminPassword       string `env:"ADMIN_PASSWORD"`
    AdminSessionSecret  string `env:"ADMIN_SESSION_SECRET"`
    PortalSessionSecret string `env:"PORTAL_SESSION_SECRET"`
    QueueTTLSeconds     int    `env:"QUEUE_TTL_SECONDS" envDefault:"900"`
    CallbackTTLSeconds  int    `env:"CALLBACK_TTL_SECONDS" envDefault:"55"`
    LogLevel            string `env:"LOG_LEVEL" envDefault:"info"`
}

func Load() (*Config, error) {
    var cfg Config
    if err := env.Parse(&cfg); err != nil {
        return nil, err
    }
    return &cfg, nil
}
```

### 2. `internal/database/db.go` 작성
```go
package database

import (
    "github.com/jmoiron/sqlx"
    _ "github.com/lib/pq"
)

func Connect(databaseURL string) (*sqlx.DB, error) {
    db, err := sqlx.Connect("postgres", databaseURL)
    if err != nil {
        return nil, err
    }
    db.SetMaxOpenConns(25)
    db.SetMaxIdleConns(5)
    return db, nil
}
```

### 3. `cmd/server/main.go` 작성
```go
package main

import (
    "context"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
    "github.com/rs/zerolog"
    "github.com/rs/zerolog/log"

    "github.com/openclaw/relay-server-go/internal/config"
    "github.com/openclaw/relay-server-go/internal/database"
)

func main() {
    // Logger 설정
    zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
    log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

    // Config 로드
    cfg, err := config.Load()
    if err != nil {
        log.Fatal().Err(err).Msg("Failed to load config")
    }

    // DB 연결
    db, err := database.Connect(cfg.DatabaseURL)
    if err != nil {
        log.Fatal().Err(err).Msg("Failed to connect to database")
    }
    defer db.Close()

    // Router 설정
    r := chi.NewRouter()
    r.Use(middleware.RequestID)
    r.Use(middleware.RealIP)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)

    r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("OK"))
    })

    // TODO: 핸들러 등록

    // Server 시작
    server := &http.Server{
        Addr:    fmt.Sprintf(":%d", cfg.Port),
        Handler: r,
    }

    go func() {
        log.Info().Int("port", cfg.Port).Msg("Starting server")
        if err := server.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatal().Err(err).Msg("Server error")
        }
    }()

    // Graceful shutdown
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    server.Shutdown(ctx)
}
```

### 4. `Dockerfile` 작성
```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o server ./cmd/server

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/server .
COPY static ./static
EXPOSE 8080
CMD ["./server"]
```

### 5. 의존성 설치
```bash
cd relay-server-go
go get github.com/go-chi/chi/v5
go get github.com/jmoiron/sqlx
go get github.com/lib/pq
go get github.com/redis/go-redis/v9
go get github.com/go-playground/validator/v10
go get github.com/caarlos0/env/v11
go get github.com/rs/zerolog
go get golang.org/x/crypto/bcrypt
go mod tidy
```

---

## 참조 파일 목록 (TypeScript 원본)

이미 읽은 파일들:

| 파일 | 설명 |
|------|------|
| `src/db/schema.ts` | 전체 DB 스키마 (7테이블, 4enum) |
| `src/routes/kakao.ts` | Kakao 웹훅, 명령어 파싱 |
| `src/routes/openclaw.ts` | OpenClaw API (messages, reply, pairing, ack) |
| `src/routes/admin.ts` | Admin API (CRUD, stats) |
| `src/routes/portal.ts` | Portal API (signup, login, connections) |
| `src/middleware/auth.ts` | Bearer 토큰 인증 |
| `src/middleware/admin-auth.ts` | Admin 세션 인증 |
| `src/services/message.service.ts` | 메시지 CRUD |
| `src/services/pairing.service.ts` | 페어링 코드 생성/검증 |
| `src/services/conversation.service.ts` | 대화 매핑 관리 |
| `src/services/kakao.service.ts` | Kakao callback 전송 |
| `src/services/account.service.ts` | 계정 관리 |
| `src/services/portal.service.ts` | 포털 signup/login |
| `src/services/session.service.ts` | 포털 세션 관리 |
| `src/config/env.ts` | 환경변수 스키마 |
| `src/types/kakao.ts` | Kakao 요청/응답 타입 |

---

## 핵심 아키텍처: SSE + Redis Pub/Sub

```
┌─────────────┐     ┌─────────────┐
│ Instance 1  │     │ Instance 2  │
│   (Go)      │     │   (Go)      │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 │
        ┌────────▼────────┐
        │  Redis Pub/Sub  │
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │   PostgreSQL    │
        └─────────────────┘
```

### 메시지 흐름
1. OpenClaw → `GET /v1/events` (SSE 연결)
2. Kakao → `POST /kakao/webhook` → DB 저장 → Redis PUBLISH
3. Redis SUBSCRIBE → 해당 Instance의 SSE 클라이언트에 push
4. OpenClaw → `POST /v1/reply` → Kakao Callback URL로 전송

---

## 주의사항

1. **비밀번호 해싱**: Bun.password.hash → bcrypt 사용
2. **세션 토큰 해싱**: HMAC-SHA256 (secret 키 사용)
3. **Kakao 서명 검증**: HMAC-SHA256 (선택적)
4. **시간대**: PostgreSQL timestamp with timezone 사용
5. **UUID**: PostgreSQL uuid_generate_v4() 사용
6. **정적 파일**: `/admin/*`, `/portal/*` SPA 서빙 (index.html fallback)

---

## 테스트 방법

```bash
# 서버 실행
go run ./cmd/server

# 헬스체크
curl http://localhost:8080/health

# SSE 연결 테스트
curl -N -H "Authorization: Bearer <token>" http://localhost:8080/v1/events

# Kakao webhook 시뮬레이션
curl -X POST http://localhost:8080/kakao/webhook \
  -H "Content-Type: application/json" \
  -d '{"userRequest":{"user":{"id":"test"},"utterance":"hello"}}'
```

---

## 작성자
- 날짜: 2026-02-01
- 모델: Claude Opus 4.5
- 세션: Phase 1 시작 직전에 중단
