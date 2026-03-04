# kakao-talkchannel-relay Cloud Run 배포 실패 분석 리포트

작성일: 2026-03-04 (KST)
대상 리비전: `kakao-talkchannel-relay-00077-8tt`
서비스: `kakao-talkchannel-relay` (프로젝트 `haruto-snow`, 리전 `asia-northeast3`)

## 1) 요약 결론

배포 실패(`00077-8tt`)는 **애플리케이션 컨테이너가 포트 8080 리스닝 전에 종료**되어 발생했습니다.  
코드 변경 회귀 가능성은 낮고, **런타임 초기화 단계(DB/Redis/설정 검증)에서의 종료** 가능성이 높습니다.

가장 유력한 원인은 다음 2가지입니다.

1. `REDIS_URL`(또는 `DATABASE_URL`) 최신 Secret 값의 유효성/접속성 문제
2. 프로덕션 설정 검증(`internal/config`)에서 세션 시크릿 값 조건(길이/약한 값)에 걸린 경우

특히 이번 배포는 `--set-secrets ...:latest`를 사용하므로, Secret 최신 버전이 바뀌었을 경우 기존 리비전(`00076`)과 신규 리비전(`00077`) 동작이 달라질 수 있습니다.

## 2) 핵심 증거

### A. 실패 타입 확인 (Cloud Run)

`/Users/bclaw/.config/gcloud/logs/2026.03.04/19.01.33.267729.log`에 다음 오류가 기록됨:

- 2026-03-04 19:01:53 (KST)
- `The user-provided container failed to start and listen on the port ... PORT=8080`
- 실패 리비전: `kakao-talkchannel-relay-00077-8tt`

즉, 배포 자체(이미지 빌드/푸시)는 성공했으나, **컨테이너 시작 후 앱 프로세스가 포트 바인딩 전에 종료**됨.

### B. 빌드 성공 확인

`/Users/bclaw/.config/gcloud/logs/2026.03.04/18.59.43.057593.log`:

- Cloud Build 상태 `SUCCESS`
- 이미지 푸시 완료 후 deploy 단계로 진행

따라서 이미지 빌드 실패가 원인이 아님.

### C. 리비전 상태 확인

`/Users/bclaw/.config/gcloud/logs/2026.03.04/20.48.00.174568.log`:

- `X kakao-talkchannel-relay-00077-8tt` (실패)
- `✔ kakao-talkchannel-relay-00076-v8w` (ACTIVE, 트래픽 유지)

즉, 새 리비전만 실패했고 서비스는 직전 정상 리비전으로 유지됨.

## 3) 요청사항별 점검 결과

## 3-1. 환경 변수/Secret 설정 오류 점검 (신규 항목 포함)

배포 시점(`19:01`) 파라미터:

- `--set-env-vars LOG_LEVEL=info,CALLBACK_TTL_SECONDS=55`
- `--set-secrets`
  - `DATABASE_URL=kakao-relay-database-url:latest`
  - `REDIS_URL=kakao-relay-redis-url:latest`
  - `ADMIN_PASSWORD=kakao-relay-admin-password:latest`
  - `PORTAL_SESSION_SECRET=kakao-relay-session-secret:latest`
  - `ADMIN_SESSION_SECRET=kakao-relay-admin-session-secret:latest`

관찰사항:

- 직전 정상 리비전(`00076`)도 동일한 Secret 키 구성을 사용.
- `PORTAL_BASE_URL`은 기존 서비스에 있었으나 이번 deploy 인자에는 없음(옵션값).  
  이는 앱 기동 필수 항목이 아니므로 직접적인 기동 실패 원인 가능성은 낮음.
- 코드/문서에는 `ADMIN_PASSWORD_HASH`가 도입됐지만 deploy 스크립트는 여전히 `ADMIN_PASSWORD`를 주입 중.  
  이는 기능/보안 관점의 불일치 이슈이나, 현재 코드상 기동 즉시 실패를 직접 유발하는 구조는 아님.

판단:

- “신규로 추가된 필수 env/secret 누락”이 명확히 확인되지는 않음.
- 다만 `:latest` 참조 구조상 Secret 최신 버전 드리프트가 있으면 신규 리비전만 실패할 수 있음.

## 3-2. Redis 접속 정보(REDIS_URL) 및 VPC 커넥터 점검

확인된 값:

- `REDIS_URL <- kakao-relay-redis-url:latest`
- VPC connector: `svpc-auth-an3`
- Egress: `private-ranges-only`

중요 코드 경로(`cmd/server/main.go`):

1. `config.Load() / Validate()`
2. `database.Connect() / db.Ping()`
3. `redis.NewClient(cfg.RedisURL)` 내부 `redis.ParseURL()` + `PING`
4. 그 다음에야 `ListenAndServe()`

즉 `REDIS_URL` 파싱 오류/접속 실패 시 **즉시 프로세스 종료**하며, Cloud Run에서는 현재와 동일하게 “PORT 리스닝 실패”로 보입니다.

판단:

- VPC connector 설정 자체는 직전 정상 리비전과 동일.
- 따라서 인프라 경로 자체보다는 `REDIS_URL latest` 값/대상 변경(혹은 대상 Redis 상태 변화)이 더 의심됨.

## 3-3. 최근 코드 변경(`internal/config`, `internal/handler`) 초기화 로직 오류 점검

비교 결과:

- `git diff 0043154..4ef0d0e -- cmd/server internal/config internal/handler`
- 변경 파일: `deploy.sh`만 변경

즉, **직전 정상 리비전 대비 서버 초기화 코드(`internal/config`, `internal/handler`, `cmd/server`) 변경 없음**.

판단:

- 코드 회귀로 신규 크래시가 발생했을 가능성은 낮음.
- 배포 파라미터/Secret 최신값/외부 의존성 상태 문제 가능성이 더 높음.

## 4) 최종 진단

가장 가능성이 높은 원인:

1. `REDIS_URL` 또는 `DATABASE_URL`의 `latest` Secret 값이 신규 인스턴스에서 유효하지 않거나 도달 불가
2. 프로덕션 설정 검증(`ADMIN_SESSION_SECRET`, `PORTAL_SESSION_SECRET`)에 신규 latest 값이 걸려 기동 중단

낮은 가능성:

- 최근 코드 변경에 의한 초기화 버그 (근거 부족, 변경 없음)
- 포트/컨테이너 설정 자체 문제 (기존과 동일하게 8080 사용)

## 5) 권장 후속 조치 (즉시)

1. `00077-8tt` 리비전 로그에서 첫 fatal 메시지 확인  
   - 필터: `resource.labels.revision_name="kakao-talkchannel-relay-00077-8tt"`
   - 기대 메시지: `failed to connect to redis` / `failed to connect to database` / `invalid configuration`

2. Secret 버전 고정 재배포로 드리프트 차단  
   - `:latest` 대신 직전 정상 시점 버전 번호로 임시 고정 후 재배포

3. `kakao-relay-redis-url` 값 검증  
   - URL 스킴/포맷(`redis://` 또는 `rediss://`), 호스트, 포트, 인증정보 확인
   - VPC egress(`private-ranges-only`)와 대상 주소 타입(사설/공인) 정합성 확인

4. deploy 스크립트 정합성 정리  
   - `ADMIN_PASSWORD` -> `ADMIN_PASSWORD_HASH` 전환 (코드/문서/배포 일치화)

---

분석 제한사항:

- 현재 실행 환경의 네트워크 제한으로 Cloud Logging API에 실시간 조회 불가.
- 따라서 앱 stderr 원문(fatal 1라인) 직접 확보는 미완료이며, 위 결론은 로컬 gcloud 실행 로그/코드 경로 기반 진단입니다.
