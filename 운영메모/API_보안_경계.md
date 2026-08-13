# API 보안 경계

## 분류 원칙

- 공개 읽기: 서버 상태나 공개 콘텐츠만 반환하며 운영 데이터를 변경하지 않는다.
- 고객 쓰기: 상담·견적·첨부처럼 제품 동작에 필요한 최소 쓰기만 허용한다.
- 관리자: Supabase Auth 로그인 후 `app_metadata.role`이 `admin` 또는 `operator`인 계정에 서버 세션을 발급해 허용하는 운영 조회·변경이다.
- 내부 연동: 서버 환경변수의 service credential로만 외부 서비스를 호출한다. credential은 브라우저 번들에 포함하지 않는다.

기본 JSON 본문 한도는 100KB다. 사진 base64를 받는 `POST /api/quote`만 10MB를 허용한다.

## Route threat matrix

| Route | 분류 | 인증 | 제한·검증 | Side effect |
|---|---|---|---|---|
| HTML·정적 자산, `GET /api/health`, `GET /api/version` | 공개 읽기 | 없음 | 정적 경로 화이트리스트·보안 헤더 | 없음 |
| `GET /api/find-example` | 공개 읽기 | 없음 | chat rate limit·입력 enum/길이 | Supabase 읽기 |
| `GET /api/og` | 공개 읽기 | 없음 | remote-fetch rate limit·HTTP(S)·기본 포트·사설 IP·redirect·512KB 제한 | 외부 HTTP 요청 |
| `POST /api/track-visit` | 고객 쓰기 | 없음 | chat rate limit·문자열 길이/문자 제한 | 방문 로그 insert |
| `POST /api/upload` | 고객 쓰기 | 없음 | 10회/10분·10MB·확장자/MIME/magic byte 일치 | 공개 Storage 객체 생성 |
| `POST /api/chat` | 고객 쓰기·비용 | session ID capability | 10회/분·20,000자·서버 role 부여·동일 세션 직렬화 | LLM 호출·상담/견적 저장·운영 알림 |
| `POST /api/session/register` | 고객 쓰기 | session ID capability | 20회/분·활성 세션 1,000개 상한·필드 길이 제한 | 메모리 세션·방문 로그 |
| `GET /api/session/status`, `POST /api/session/typing`, `POST /api/session/mark-read` | 고객 세션 | session ID capability | 고엔트로피 신규 ID·형식 검증·읽음 쓰기 직렬화 | 메모리 상태·읽음 저장 |
| `POST /api/quote` | 고객 쓰기 | 없음 | 10회/분·전용 10MB parser·입력 길이·전화번호·멱등키 | 견적·선택 고객 연동 저장 |
| `POST /api/admin-auth/login` | 관리자 인증 | Supabase Auth | 실패 로그인 20회/15분·`app_metadata.role` 허용 목록 | HttpOnly 서버 세션 발급 |
| `/api/admin/*` | 관리자 | HttpOnly 서버 세션 | 변경 요청 CSRF token·same-origin 검증·입력 길이·테이블 화이트리스트 | 상담·설정·메모·백업·세션 상태 조회/변경 |
| `GET/PATCH /api/quotes*` | 관리자 | HttpOnly 서버 세션 | 변경 요청 CSRF token·same-origin 검증·수정 필드 화이트리스트 | 견적 조회/변경 |
| `POST /api/summarize` | 내부 관리자 | HttpOnly 서버 세션 | CSRF token·same-origin 검증·기본 100KB parser | LLM·Supabase·Notion 호출 |

## 관리자 인증 운용

관리자는 Supabase Auth로 로그인한다. 계정의 `app_metadata.role`이 `admin` 또는 `operator`일 때만 서버가 관리자 세션을 발급하며, 두 역할은 동일한 기능에 접근한다. Supabase 내부 DB role이나 사용자가 수정할 수 있는 user metadata는 관리자 권한 판정에 사용하지 않는다.

세션 식별자는 Secure·HttpOnly·SameSite=Strict 쿠키로만 전달한다. 변경 요청은 별도의 CSRF 쿠키·헤더와 요청 Origin을 함께 검증한다. 정적 번들, `sessionStorage`, `Authorization` 헤더에는 관리자 credential을 저장하거나 전달하지 않는다.

## 업로드 운영

허용 파일은 이미지, PDF, 영상, 음성의 명시된 확장자만이다. 확장자와 브라우저 MIME이 일치해야 하며 서버가 파일 signature를 다시 확인한다. Storage에는 서버가 결정한 content type으로 저장한다.

현재 객체는 상담 첨부 링크로 사용되므로 일괄 TTL 삭제하지 않는다. orphan 정리가 필요하면 상담 메시지와 Storage 경로를 대조하는 별도 보존 정책을 먼저 확정한다.

## 배포 확인

1. 배포 설정과 브라우저 번들에 기존 관리자 토큰 계약이 남아 있지 않은지 확인한다.
2. 허용된 역할의 계정으로 로그인해 관리자 조회·수정 API를 확인하고, 역할이 없는 계정은 거부되는지 확인한다.
3. 고객 채팅, 견적 폼, 이미지/PDF 업로드를 확인한다.
4. 위장 파일, 10MB 초과 파일, 사설 주소 OG 요청이 4xx로 거부되는지 확인한다.
5. 애플리케이션 로그에 토큰·전화번호·고객명이 출력되지 않는지 확인한다.

## 소스

- `server.js`
- `js/admin-config.js`
- `js/chat.js`
- `js/quote.js`
- `preview_site/js/admin-config.js`
- `preview_site/js/chat.js`
- `preview_site/js/quote.js`
- `lib/admin-auth.js`
- `lib/security-boundaries.js`
- `test/admin-auth.test.js`
- `test/security-boundaries.test.js`
