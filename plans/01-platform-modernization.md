# [plan-01] 상담·관리자 플랫폼 현대화

## 상태

- 문서 상태: 실행 기준선
- 기준일: 2026-07-20
- 기술 방향: Express 유지, React + TypeScript 점진 도입
- 배포 원칙: 작은 PR, 계약 우선, 단계별 전환, 즉시 롤백 가능
- 관련 기존 이슈: #28, #63, #64, #66, #67, #68
- 독립 연계 이슈: #62

## 1. 문제 정의

현재 서비스는 고객 상담, 견적 접수, 관리자 운영, AI 호출, 데이터 저장이 하나의 Express 애플리케이션과 전역 상태 중심의 브라우저 코드에 밀집되어 있다. 관리자 인증은 사용자 계정이 아닌 공유 비밀값에 의존하고, 고객 상담의 식별자와 소유권이 분리되어 있지 않다. 이전 상담은 브라우저 로컬 기록과 서버 기록의 의미가 다르며, 오래된 상담이 같은 식별자로 덮어써질 수 있다. UI는 기능은 많지만 전역 함수, HTML 문자열 렌더링, 중복 폴링, 인라인 이벤트 및 고정 위치 계산에 의존한다.

이번 작업은 화면 프레임워크만 교체하는 프로젝트가 아니다. 다음 경계를 동시에 바로잡는 플랫폼 현대화다.

1. 관리자 신원, 세션, 권한, 감사 경계
2. 고객 방문자, 상담 건, 메시지 이벤트, 실시간 상태의 데이터 경계
3. 견적 폼, 개인정보 동의, 첨부파일, 후속 업무 저장의 계약
4. React + TypeScript 기반의 유지 가능한 관리자 및 고객 UI
5. 모바일, 접근성, 오류 복구, 테스트 및 안전한 배포 기준

## 2. 확정된 기본 결정

이 절은 구현자가 임의로 다시 선택하지 않는 기준선이다. 변경하려면 15절의 변경 절차를 따른다.

### ADR-001 — 전면 Next.js 재작성 금지

- Express API와 정적 공개 페이지는 유지한다.
- 관리자 화면부터 React + TypeScript로 전환한다.
- 고객 상담과 견적 화면은 공통 계약이 안정된 뒤 순차 전환한다.
- Next.js 도입은 공개 콘텐츠의 SSR/SSG 요구가 실제로 생길 때 별도 결정한다.

### ADR-002 — 기존 API를 직접 덧대지 않고 버전 경계를 만든다

- 새 기능은 `/api/v2` 계약을 사용한다.
- 기존 API는 전환 기간 동안 호환 계층으로만 유지한다.
- 새 UI가 기존 응답 모양을 추측하거나 전역 상태를 재사용하지 않는다.
- 모든 응답은 성공 데이터 또는 표준 오류 envelope 중 하나다.

### ADR-003 — 관리자 인증은 사용자 계정과 서버 세션이다

- Supabase Auth를 신원 공급자로 사용한다.
- 공개 회원가입과 계정 관리 UI는 제공하지 않는다.
- Supabase Auth 인증 후 `app_metadata.role`이 `admin` 또는 `operator`인 계정만 관리자 접근을 허용한다.
- 두 역할은 애플리케이션에서 동일한 관리자 권한을 가지며 별도 권한 등급을 나누지 않는다.
- 여러 기기에서 같은 계정으로 로그인할 수 있지만 세션은 기기별로 분리한다.
- 브라우저에는 공유 토큰, service key, refresh token을 JavaScript로 노출하지 않는다.
- 서버가 발급한 불투명 세션을 `HttpOnly`, `Secure`, `SameSite=Strict` 쿠키로 보관한다.
- 세션은 60분 유휴 만료, 12시간 절대 만료로 한다.
- 변경 요청은 Origin 검증과 CSRF 방어를 모두 통과해야 한다.

### ADR-004 — 고객 상담 ID와 소유권을 분리한다

- 상담 ID는 공개 식별자일 뿐 권한 증명이 아니다.
- 서버가 익명 방문자 자격증명을 쿠키로 발급하고 해시만 저장한다.
- 모든 상담 읽기·쓰기 API는 방문자 소유권을 검증한다.
- 초기 릴리스의 이전 상담은 동일 브라우저에서만 제공한다.
- 전화번호 인증을 통한 기기 간 복원은 별도 인증 공급자와 비용 결정 전까지 범위 밖이다.

### ADR-005 — 상담은 불변 이벤트 기록을 정본으로 한다

- 방문자, 상담 건, 메시지 이벤트, 실시간 presence를 별도 개념으로 관리한다.
- 새 상담 시작은 항상 새 상담 건을 만든다.
- 이어가기는 사용자가 명시적으로 선택한 상담에 새 이벤트를 추가한다.
- 폴링, 타이핑, 화면 열람은 상담 내용의 활동 시각을 갱신하지 않는다.
- 재시도는 동일 client event ID로 멱등 처리한다.

### ADR-006 — 실시간 전송은 우선 중앙집중형 폴링을 유지한다

- 첫 전환에서는 WebSocket/SSE를 도입하지 않는다.
- 폴링은 화면마다 별도 타이머를 만들지 않고 하나의 query 계층에서 관리한다.
- 이전 요청 취소, stale 응답 폐기, 백오프, 비활성 탭 감속을 적용한다.
- 운영 지표가 폴링 비용이나 지연 문제를 입증하면 별도 ADR로 전송 방식을 바꾼다.

### ADR-007 — 폼은 정형 계약이며 AI가 확정하지 않는다

- 설치 형태는 단일 선택이며 `모름`을 유효한 선택으로 둔다.
- 치수는 `known` 또는 `unknown` 상태를 명시하며, 모른다는 이유로 상담이나 견적 요청을 차단하지 않는다.
- AI 추출값은 초안일 뿐 고객 제출 또는 관리자 확정 전에는 운영 견적·고객·설치 레코드를 만들지 않는다.
- 개인정보 동의는 문구 버전, 시각, 출처, 사용자 행위와 함께 저장한다.
- AI나 관리자가 동의를 임의로 `true`로 만들 수 없다.

### ADR-008 — 첨부파일은 비공개 저장을 기본으로 한다

- 고객 파일은 private bucket에 저장한다.
- 접근은 짧은 signed URL 또는 인증된 다운로드 API만 허용한다.
- 업로드 intent, 소유자, 상담/견적 연결, 용도, 생성 시각을 기록한다.
- DB 저장 실패, 삭제, 보존기간 만료 시 object 정리 경로가 있어야 한다.
- 애플리케이션 시작 과정에서 버킷이나 정책을 자동 변경하지 않는다.

### ADR-009 — 디자인은 브랜드 유지, 정보 구조 재설계다

- 기존 색감과 브랜드 인상은 보존하되 현재 DOM 구조나 픽셀 배치를 호환 대상으로 삼지 않는다.
- `DESIGN.md`를 색, 타이포, 간격, breakpoint, 상태, 접근성의 권위 문서로 만든다.
- 핵심 관리자 업무는 360px 모바일에서도 완료할 수 있어야 한다.
- 대량 인쇄·엑셀 작업은 모바일에서 실행 가능하되 데스크톱 최적화를 허용한다.

### ADR-010 — 운영 보존 기본값

- 고객 상담 및 첨부파일 기본 보존기간은 현재 공개 정책과 맞춰 90일로 한다.
- soft delete, restore, hard delete의 대상별 cascade 표를 마이그레이션 전에 확정한다.
- 법무·운영 정책 변경이 있으면 코드보다 정책 문서를 먼저 갱신한다.

## 3. 사용자와 접근 주체

### 고객

- 로그인 없이 새 상담을 시작한다.
- 자신의 현재 상담과 동일 브라우저의 이전 상담만 볼 수 있다.
- 새 상담과 기존 상담 이어가기를 명확히 선택한다.
- 견적을 작성하고, 파일을 첨부하고, 제출 상태와 실패 복구 방법을 확인한다.

### 관리자

- Supabase Auth 계정으로 로그인하며 `admin`과 `operator`는 동일한 관리자 권한을 갖는다.
- 상담, 메시지, AI 난입·해제, 메모, 견적, 통계, 휴지통, 백업, 설정을 모두 사용한다.
- 별도 역할, 권한 등급, 사용자 초대, 계정 관리 화면을 두지 않는다.
- 감사 기록은 Supabase Auth 계정과 로그인 세션 단위로 식별한다.

## 4. 기능 요구사항

### AUTH — 관리자 인증과 권한

- AUTH-01: 미인증 사용자가 `/admin`에 접근하면 로그인 화면만 표시한다.
- AUTH-02: 인증 전에는 관리자 데이터 API를 호출하지 않는다.
- AUTH-03: 로그인, 로그아웃, 유휴 만료, 절대 만료를 지원한다.
- AUTH-04: 모든 관리자 API는 하나의 인증 미들웨어를 거친다.
- AUTH-05: `app_metadata.role`의 `admin`·`operator`만 허용하되 두 역할 사이의 권한 분기와 계정 관리 UI는 구현하지 않는다.
- AUTH-06: 중요 작업에는 관리자 session ID, action, target, outcome, request ID, 시각을 기록한다.
- AUTH-07: 로그아웃 후 브라우저 뒤로가기로 보호 데이터가 복원되지 않는다.
- AUTH-08: 인증 실패 메시지는 계정 존재 여부를 노출하지 않는다.

### CONV — 상담 저장과 이전 상담

- CONV-01: 새로고침, 브라우저 재시작, 서버 재시작 후 현재 상담이 동일하게 복원된다.
- CONV-02: 1시간 또는 1일 후 재방문해도 과거 메시지가 빈 상담으로 덮어써지지 않는다.
- CONV-03: 이전 상담 목록은 최근 90일, 최대 10건을 서버 정본에서 제공한다.
- CONV-04: 새 상담과 이어가기를 별도 명령으로 제공한다.
- CONV-05: 이어가기는 원본 상담의 메시지와 첨부파일 연결을 보존한다.
- CONV-06: 다른 방문자의 상담 ID를 알아도 읽기·쓰기·typing·읽음 변경을 할 수 없다.
- CONV-07: 동일 메시지 재전송은 한 번만 기록한다.
- CONV-08: 멀티탭 동시 전송은 서버 수신 순서와 이벤트 시각을 보존하며 UI에 중복 표시하지 않는다.
- CONV-09: 메시지는 `pending`, `sent`, `failed` 상태와 재시도 동작을 가진다.
- CONV-10: 관리자 takeover, unread, 마지막 읽음 상태는 서버 재시작 후에도 복원된다.

### FORM — 견적 및 정보 수집 폼

- FORM-01: 프론트와 서버가 동일한 런타임 schema를 사용한다.
- FORM-02: 설치 형태는 단일 선택이고 `모름`을 허용한다.
- FORM-03: 치수 미확정 경로를 제공하며 후속 확인 필요 상태로 저장한다.
- FORM-04: 필드 오류는 입력과 연결되고 오류 요약에서 첫 오류로 이동할 수 있다.
- FORM-05: 이름, 전화, 지역에 올바른 autocomplete와 mobile inputmode를 적용한다.
- FORM-06: 중복 클릭, timeout, 응답 유실 후 재시도에도 견적은 한 건만 생성한다.
- FORM-07: 첨부파일은 JSON base64가 아닌 별도 업로드 흐름을 사용한다.
- FORM-08: 업로드 진행률, 취소, 실패 재시도, 제출 전 삭제를 제공한다.
- FORM-09: 비민감 구성값만 24시간 로컬 임시저장한다. 이름·전화·파일은 기본적으로 영속 저장하지 않는다.
- FORM-10: 개인정보가 입력된 상태에서 이탈하면 경고한다.
- FORM-11: 개인정보 동의는 서버에서 재검증하고 동의 증적을 저장한다.
- FORM-12: primary 견적 저장과 customer/install 후속 연동 결과를 분리한다.
- FORM-13: 후속 연동 실패는 durable outbox로 재시도하며 이미 접수된 견적을 고객에게 실패로 표시하지 않는다.

### ADMIN — 관리자 기능 이관

- ADMIN-01: 대시보드, 견적, 실시간 상담, 저장 상담, 통계, 메모, 휴지통, 백업 기능을 기능 인벤토리 기준으로 이관한다.
- ADMIN-02: 화면별 loading, empty, error, retry 상태를 제공한다.
- ADMIN-03: 선택 상담 변경 시 이전 요청을 취소하거나 결과를 폐기한다.
- ADMIN-04: 폴링으로 입력 중인 메시지, 첨부, 답장 상태가 사라지지 않는다.
- ADMIN-05: 사용자가 메시지 하단을 보고 있을 때만 새 메시지에 자동 스크롤한다.
- ADMIN-06: 모바일에서 상담 보기·답장·첨부·검색·메모·난입·해제를 모두 완료할 수 있다.
- ADMIN-07: destructive action은 대상과 결과를 명확히 보여주는 확인 단계를 가진다.
- ADMIN-08: 서버 문자열을 HTML로 삽입하지 않고 텍스트로 렌더링한다.

### UI — 공통 UI, 모바일, 접근성

- UI-01: TypeScript strict mode에서 오류가 없어야 한다.
- UI-02: 모든 인터랙션은 semantic button, link, form control을 사용한다.
- UI-03: dialog는 이름, 역할, focus trap, Escape, 닫은 뒤 focus 복귀를 제공한다.
- UI-04: 동적 성공·실패·대기 상태는 적절한 live region으로 전달한다.
- UI-05: 키보드만으로 모든 핵심 고객·관리자 흐름을 완료할 수 있다.
- UI-06: WCAG 2.2 AA를 목표로 대비, focus, reflow, target size를 검증한다.
- UI-07: 360×640, 390×844, 768×1024, 1024×768, 1440×900에서 핵심 E2E를 통과한다.
- UI-08: iOS Safari와 Android Chrome의 가상 키보드에서 입력창과 dialog가 가려지지 않는다.
- UI-09: 모바일에서 기능을 숨겨 데스크톱보다 결과를 제한하지 않는다.
- UI-10: `dangerouslySetInnerHTML`, 인라인 이벤트, 신규 `window.*` 전역 API를 금지한다.

### API — 오류·보안·관측성

- API-01: 각 route의 인증, rate limit, body limit, schema, side effect를 표로 관리한다.
- API-02: rate limit은 HTTP 통합 테스트에서 실제 N+1 요청이 429가 됨을 검증한다.
- API-03: 공개, 고객 소유, 관리자, 내부 서비스 API를 별도 router와 권한으로 분리한다.
- API-04: 오류 응답에는 안정적인 code, 사용자 메시지, request ID, 선택적 field errors만 포함한다.
- API-05: 로그에는 비밀값, 전체 전화번호, 전체 메시지 본문을 기록하지 않는다.
- API-06: liveness와 dependency readiness를 분리한다.
- API-07: DB, AI, Storage 장애는 degraded 상태와 사용자 fallback을 가진다.
- API-08: 공개 쓰기·비용 발생 경로는 abuse, concurrency, idempotency 테스트를 가진다.

## 5. 데이터 경계

최소 논리 모델은 다음과 같다. 실제 이름과 SQL은 운영 스키마 read-only scan 후 확정하지만 의미를 합치지 않는다.

```text
admin_user
admin_session
admin_audit_event

visitor
conversation
conversation_event
conversation_participant
conversation_presence

quote
quote_consent
upload_object
integration_outbox
```

필수 불변식:

- 방문자 하나는 여러 상담을 가질 수 있다.
- 상담 이벤트는 덮어쓰지 않고 추가한다.
- 상담 삭제 상태와 보존 만료는 프로세스 메모리가 아닌 DB에 존재한다.
- 첨부파일은 반드시 소유자와 업무 대상에 연결된다.
- 견적 제출의 멱등키는 DB unique constraint로 강제한다.
- AI 결과는 확정 견적 및 동의 증적의 작성자가 될 수 없다.
- 외부 연동 실패는 primary 업무 데이터의 성공 여부와 분리한다.

## 6. API 계약 기준

표준 성공 응답:

```json
{ "data": {}, "meta": { "requestId": "..." } }
```

표준 오류 응답:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "입력 내용을 확인해 주세요.",
    "requestId": "...",
    "fieldErrors": { "phone": "연락처 형식을 확인해 주세요." }
  }
}
```

계약 규칙:

- 날짜는 UTC ISO 8601, 금액은 정수 원, 치수는 정수 mm를 사용한다.
- 전화번호는 서버에서 canonical form으로 정규화한다.
- 목록은 cursor pagination을 사용한다.
- mutation은 idempotency key 또는 version precondition을 사용한다.
- `401`은 미인증, `403`은 권한 부족, `409`는 충돌, `422`는 필드 검증 실패다.
- UI는 알 수 없는 enum 값을 숨기지 않고 안전한 fallback으로 표시한다.

## 7. 기술 구성

### 프론트엔드

- React + TypeScript + Vite
- React Router
- TanStack Query: 서버 상태, 폴링, 취소, 캐시
- React Hook Form + Zod: 폼 상태와 런타임 검증
- Testing Library + Vitest: 컴포넌트 테스트
- Playwright + axe: 브라우저, 모바일, 접근성 E2E

라이브러리 선택 원칙:

- API가 공식 문서에 존재하는지 Phase 0에서 확인한 뒤 잠금 버전을 정한다.
- UI component library를 먼저 도입하지 않는다. `DESIGN.md`와 최소 primitive를 만든 후 반복 비용을 측정한다.
- 서버 데이터를 전역 store에 복제하지 않는다.

### 백엔드

- Express 유지
- 신규 기능은 domain router/service/repository 경계로 추출
- 기존 Node 테스트 유지
- 런타임 schema와 HTTP 통합 테스트 추가
- `server.js`는 최종적으로 composition root 역할만 하며, 여러 병렬 작업자가 동시에 직접 수정하지 않는다.

## 8. 디자인 기준

`DESIGN.md`는 구현 전에 다음을 고정한다.

- 브랜드 색과 semantic color
- 글꼴 크기, 행간, 최소 보조문자 크기
- 4px 기반 spacing scale
- radius, shadow, border
- 360/768/1024 기준 breakpoint
- loading, empty, error, success, disabled, destructive 상태
- focus ring, 최소 target size, motion 감소
- shell, navigation, list/detail, form, dialog, toast primitive

기존 화면은 기능 인벤토리의 참고 자료이며 디자인 SOT가 아니다.

## 9. 단계와 병렬 실행 계획

### Phase 0 — 문서·운영 계약 확인

구현:

- 공식 문서의 실제 API와 버전을 확인한다.
- 운영 DB, RLS, Storage 정책을 read-only scan한다.
- 전체 route threat matrix와 기존 동작 characterization test를 만든다.
- #28 테스트 환경 정책을 확정한다.

검증:

- 운영 데이터를 변경하지 않고 schema compatibility report 생성
- 모든 route의 auth/rate/body/schema/side-effect 행 존재
- 현재 실패를 재현하는 HTTP 테스트 존재

금지:

- 운영 migration 실행
- 문서에 없는 auth/session API 추정
- 운영 데이터로 쓰기 테스트

### Phase 1 — 안전장치와 공통 계약

구현:

- PR test/typecheck/build workflow
- 표준 오류, request ID, runtime schema
- `DESIGN.md` 및 공통 UI token
- 신규 React 관리자 shell과 API mock
- 현재 공개 API containment 완료

검증:

- 기존 Node 테스트 + 신규 HTTP 테스트 통과
- React build/typecheck/component smoke 통과
- 모바일 shell과 로그인 화면 screenshot baseline

금지:

- 인증 전에 운영 관리자 데이터를 신규 UI에 연결
- branch protection 없이 병렬 PR을 연속 main merge

### Phase 2 — 관리자 인증과 읽기 전용 React 관리자

구현:

- `app_metadata.role` 게이트, 서버 세션, CSRF, 세션 단위 감사 기반
- 로그인/로그아웃/만료 UI
- 대시보드, 상담 목록, 견적 목록의 읽기 전용 이관

검증:

- 인증·권한·세션 만료 HTTP/E2E
- 인증 전 관리자 데이터 요청 0회
- desktop/mobile 읽기 업무 E2E

금지:

- 브라우저 저장소에 관리자 credential 저장
- 기존 HTML 문자열을 React에 삽입

### Phase 3 — 관리자 변경 업무 이관

구현:

- 상담 메시지, 난입, 메모, 견적 편집, 휴지통, 백업
- 중요 작업 확인 절차와 session 단위 audit
- 중앙 query/polling 계층

검증:

- 느린 응답, 선택 변경, 중복 전송, 권한 실패
- 모바일 핵심 업무 기능 동등성
- destructive action audit 기록

금지:

- 화면별 독립 `setInterval`
- 확인 없는 hard delete

### Phase 4 — 상담 소유권과 이벤트 정본

구현:

- visitor/conversation/event/presence 모델
- 익명 소유권 credential
- 새 상담/이어가기/이력 API
- legacy session read-only 전환 및 종료일

검증:

- 재시작, 1시간/1일, 멀티탭, replay, 타인 ID 접근
- 기존 상담 불변 보존
- legacy 데이터 migration dry-run

금지:

- 기존 단일행을 새 빈 상담으로 덮어쓰기
- conversation ID만으로 권한 승인

### Phase 5 — 견적·폼·첨부·후속 연동

구현:

- 공통 폼 schema와 새 견적 UI
- 동의 증적, private upload, submit idempotency
- quote primary 저장과 outbox integration
- #64, #63과 계약 정렬

검증:

- unknown dimensions, timeout, double submit, file failure
- customer integration 장애 시 일관된 접수 결과
- 파일 소유권, signed access, orphan cleanup

금지:

- base64 JSON 업로드
- AI의 자동 동의·자동 확정 접수

### Phase 6 — 고객 상담 React 이관

구현:

- 채팅, 퀵 선택, 첨부, 검색, 견적 확인
- 서버 정본 이전 상담 목록과 명시적 이어가기
- 메시지 pending/sent/failed와 재시도

검증:

- 모바일 키보드, 긴 대화, 느린 네트워크, 관리자 전환
- 첨부 포함 resume와 새 상담 분리
- 접근성 및 visual regression matrix

금지:

- 로컬 기록을 서버 정본으로 간주
- 모바일에서 핵심 기능 숨김

### Phase 7 — 전환과 legacy 제거

구현:

- 기능별 feature flag와 canary
- 구 UI 및 구 API 사용량 0 확인
- preview 사본 제거 또는 자동 생성 구조로 전환
- 문서·개인정보 정책·운영 runbook 정합화

검증:

- rollback rehearsal
- legacy grep 0 및 route telemetry 0
- production smoke와 readiness 통과

금지:

- 사용량 확인 전 legacy 삭제
- migration과 UI cutover를 같은 비가역 단계로 배포

## 10. 병렬 작업 DAG와 파일 소유권

```text
P0 조사/계약
├── A. CI·테스트 하네스
├── B. DESIGN.md·UI primitives
├── C. 관리자 auth schema/service
├── D. React admin shell/mock
└── E. 상담 event schema/dry-run

C + D → 관리자 읽기/변경 UI
E → 고객 이력/재개 → 고객 React UI
#64 계약 → 견적 form → #63 견적 엔진
A는 모든 merge의 게이트
```

소유권:

- 한 작업 스트림만 Express composition root를 수정한다.
- 인증, 상담, 견적, Storage, 관리자 도메인은 서로 다른 모듈에 둔다.
- 공통 계약과 migration 번호는 Phase 시작 전에 잠근다.
- 동일 HTML/JS 파일을 여러 스트림이 병렬 수정하지 않는다.
- 병렬 PR은 계약 → 기반 → 기능 순으로 merge한다.

## 11. 테스트 매트릭스

| 영역 | 필수 시나리오 |
|---|---|
| 인증 | 성공, 실패, 만료, 로그아웃, 동시 기기 세션, CSRF |
| 상담 소유권 | 정상 소유자, 타인 ID, legacy ID, 재시작, 멀티탭 |
| 상담 이력 | 새 상담, 명시적 이어가기, 1시간/1일 후, 삭제/복원 |
| 메시지 | 중복 event, timeout, retry, stale response, 관리자 전환 |
| 폼 | 정상, 치수 모름, 필드 오류, 이탈, double submit, 응답 유실 |
| 첨부 | 정상, 위장 파일, 과대 파일, 취소, orphan, 권한 없는 조회 |
| 관리자 UI | 360, 390, 768, 1024, 1440, 키보드 전용, 200% 확대 |
| 장애 | DB, Auth, AI, Storage, customer integration 각각 degraded |
| 배포 | build, migration dry-run, smoke, readiness, rollback |

## 12. CI와 배포 게이트

모든 PR:

- Node unit/integration test
- frontend lint, typecheck, unit test, production build
- 핵심 Playwright E2E
- 접근성 자동 검사
- migration lint 및 dry-run
- secret scan과 dependency audit

운영 배포:

- main merge 전에 required checks가 통과해야 한다.
- main push 배포 workflow에서도 test/build를 다시 통과한 뒤 deploy한다.
- liveness와 readiness를 분리하고 readiness 실패를 배포 성공으로 간주하지 않는다.
- migration은 별도 승인·실행 단계이며 애플리케이션 배포가 자동 적용하지 않는다.
- 각 phase는 feature flag 또는 직전 artifact로 롤백할 수 있어야 한다.

## 13. 완료 정의

다음이 모두 충족되어야 master를 완료한다.

- 공유 관리자 토큰과 prompt 인증이 제거됨
- Supabase Auth 역할 게이트, 서버 세션, 세션 단위 감사가 운영됨
- 고객 상담 ID만으로 타인 상담 접근 불가
- 과거 상담이 시간 경과나 재시작으로 덮어써지지 않음
- 새 상담과 이어가기가 제품과 API에서 구분됨
- 관리자 및 고객 핵심 UI가 React + TypeScript로 이관됨
- 모바일 핵심 기능이 데스크톱과 결과 동등함
- 견적 폼이 공통 schema, 명시적 동의, 멱등 제출을 사용함
- 고객 첨부파일이 비공개이고 삭제·만료가 추적됨
- CI, readiness, rollback 게이트가 실제 배포 흐름에 연결됨
- legacy 사용량이 0이고 승인된 제거 절차가 완료됨

## 14. 범위 밖

- 전체 공개 홈페이지의 Next.js 전환
- 공개 블로그 CMS/SEO 재구축
- 전화/SMS 기반 고객 계정과 기기 간 이력 복원
- #62 렌더 worker 및 외부 도면 생성 파이프라인
- 가격 정책 자체의 변경
- 운영 DB migration의 자동 실행

## 15. 사용자 피드백과 스펙 변경 절차

사용자는 구현 중 언제든 UI, 모바일, 이전 상담, 인증, 폼 및 백엔드 피드백을 추가할 수 있다.

처리 규칙:

1. 피드백을 `Feedback inbox` 항목으로 기록한다.
2. 현재 요구사항과 충돌 여부, 데이터/API 영향, 진행 중 PR 영향을 분석한다.
3. 모호한 문구를 테스트 가능한 acceptance criterion으로 바꾼다.
4. 결정되면 `SPEC-CHANGE-NNN`으로 이 문서와 master issue의 decision log를 갱신한다.
5. 이미 시작한 작업의 계약을 바꾸면 해당 PR을 억지로 확장하지 않고 후속 task 또는 명시적 rebase 결정을 남긴다.
6. 보안·데이터 무결성·개인정보 기준을 낮추는 변경은 별도 위험 승인 없이는 수용하지 않는다.

현재 Feedback inbox: 비어 있음.

### SPEC-CHANGE-001 — 단일 관리자 권한 모델로 단순화

- 결정일: 2026-07-20
- 요청: 허용 계정을 이메일로 고정하지 않고 관리자·운영자 역할 사이의 기능 차등을 두지 않는다.
- 반영: Supabase Auth의 신뢰 가능한 `app_metadata.role`이 `admin` 또는 `operator`인 계정만 허용하며 두 역할은 동일 권한으로 처리한다. 사용자 초대, 애플리케이션 계정 관리 UI, 중요 작업 재인증은 범위에서 제거했다.
- 유지: 공유 bearer token은 제거하고 로그인, HttpOnly 서버 세션, CSRF, 만료, 세션별 감사는 유지한다.
- 제한: Supabase의 기본 `user.role`과 사용자가 수정 가능한 `user_metadata`는 인가 근거로 사용하지 않는다.

## 16. 문서 근거와 허용 API

- React는 기존 프로젝트의 하위 경로부터 점진적으로 도입할 수 있다.
- Vite는 React + TypeScript 애플리케이션의 build/dev 기반으로 사용한다.
- Supabase Auth의 실제 서버 검증 API는 구현 Phase 0에서 설치 버전의 공식 문서와 signature를 확인한다.
- Playwright device emulation과 axe 규칙은 설치 버전의 공식 문서에 존재하는 API만 사용한다.
- Next.js Route Handler를 기존 Express 백엔드의 자동 대체재로 간주하지 않는다.

문서 링크:

- https://react.dev/learn/add-react-to-an-existing-project
- https://vite.dev/guide/
- https://supabase.com/docs/guides/auth
- https://playwright.dev/docs/emulation
- https://www.w3.org/TR/WCAG22/
- https://nextjs.org/docs/app/guides/backend-for-frontend

## 소스

| 범위 | 저장소 소스 |
|---|---|
| Express, API, 세션, 인증, Supabase | `server.js` |
| 관리자 기능 | `admin.html`, `js/admin*.js`, `css/admin.css` |
| 고객 상담과 로컬 이력 | `chat.html`, `js/chat.js`, `js/history.js`, `js/ui.js`, `css/chat.css` |
| 견적 폼 | `quote.html`, `js/quote-form.js`, `css/base.css` |
| 저장·복구·보안 계약 | `lib/*.js`, `test/*.test.js`, `migrations/*.sql` |
| 배포 | `.github/workflows/deploy-main.yml`, `package.json` |
| 기존 작업 범위 | GitHub issues #28, #62, #63, #64, #66, #67, #68 |
