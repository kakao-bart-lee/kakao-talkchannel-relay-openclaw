# AGENTS.md

Kakao 톡채널 ↔ OpenClaw AI 릴레이 서버

## Commit Convention (release-please)

```
<type>(<scope>): <description>
```

### Types

| Type | Bump | 설명 |
|------|------|-----|
| `feat` | MINOR | 새 기능 |
| `fix` | PATCH | 버그 수정 |
| `feat!` / `fix!` | MAJOR | Breaking change |
| `docs`, `style`, `refactor`, `test`, `ci`, `chore` | - | 버전 변경 없음 |

### Scopes

`api`, `kakao`, `admin`, `portal`, `db`, `sse`, `auth`, `deps`

### 예시

```bash
feat(api): add SSE endpoint
fix(kakao): normalize pairing code
feat!: replace polling with SSE
```

### 규칙

- 영어, 소문자, 마침표 없음
