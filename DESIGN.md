---
version: "alpha"
name: Kate Blanc Warm Utility
description: |
  케이트블랑 고객 상담과 관리자 운영 화면의 디자인 SOT.
  샴페인 골드와 웜화이트의 브랜드 인상을 유지하면서 모바일 업무,
  접근성, 명확한 상태 표현을 우선한다.

colors:
  primary: "#C9A96E"
  on-primary: "#2C2820"
  primary-strong: "#A8883F"
  primary-soft: "#E8D9BC"

  surface: "#FFFFFF"
  surface-warm: "#FAF9F7"
  surface-subtle: "#F4F1EC"

  on-surface: "#2C2820"
  on-surface-secondary: "#6B6056"
  on-surface-muted: "#756B62"

  outline: "#E4DDD2"
  outline-strong: "#6B6056"

  success: "#166534"
  success-container: "#DCFCE7"
  warning: "#92400E"
  warning-container: "#FEF3C7"
  danger: "#B91C1C"
  danger-container: "#FEE2E2"
  scrim: "rgba(44, 40, 32, 0.55)"
  transparent: "transparent"

typography:
  display:
    fontFamily: Cormorant Garamond
    fontSize: 40px
    fontWeight: "400"
    lineHeight: 1.25
    letterSpacing: 0.02em

  h1:
    fontFamily: Pretendard
    fontSize: 24px
    fontWeight: "700"
    lineHeight: 1.35
    letterSpacing: -0.01em

  h2:
    fontFamily: Pretendard
    fontSize: 20px
    fontWeight: "700"
    lineHeight: 1.4
    letterSpacing: 0em

  body:
    fontFamily: Pretendard
    fontSize: 15px
    fontWeight: "400"
    lineHeight: 1.7
    letterSpacing: 0em

  label:
    fontFamily: Pretendard
    fontSize: 13px
    fontWeight: "600"
    lineHeight: 1.5
    letterSpacing: 0em

  caption:
    fontFamily: Pretendard
    fontSize: 12px
    fontWeight: "400"
    lineHeight: 1.5
    letterSpacing: 0em

rounded:
  sm: 6px
  md: 12px
  lg: 20px
  full: 9999px

spacing:
  xs: 4px
  sm: 8px
  control: 12px
  md: 16px
  content: 20px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 56px
  4xl: 64px
  5xl: 96px

x-breakpoints:
  compact: 360px
  mobile: 390px
  tablet: 768px
  desktop: 1024px
  wide: 1440px

x-borders:
  default-width: 1px
  default: 1px solid "{colors.outline}"
  strong: 1px solid "{colors.outline-strong}"
  accent-width: 3px

x-shadows:
  floating: 0 12px 36px rgba(44, 40, 32, 0.16)

x-motion:
  fast: 120ms
  normal: 180ms
  reduced: 0.01ms
  easing: ease-out

x-accessibility:
  target-min: 44px
  focus-width: 3px
  focus-offset: 2px

x-layout:
  viewport-width: 100vw
  viewport-height: 100vh
  dynamic-viewport-height: 100dvh
  content-max: 1280px
  navigation-height: 64px
  badge-height: 28px
  feedback-min: 150px
  dialog-max: 520px
  toast-max: 360px
  tooltip-max: 240px
  split-columns: "minmax(260px, 0.78fr) minmax(0, 1.5fr)"
  two-columns: "repeat(2, minmax(0, 1fr))"
  one-column: "1fr"
  page-inline-fluid: 3vw
  page-block-fluid: 4vw

x-type-details:
  brand-size: 18px
  page-title-max: 36px
  eyebrow-tracking: 0.08em

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 12px

  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 12px

  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 12px

  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
    padding: 24px

  badge:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: 4px

  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 24px

  chat-bubble-user:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px

  page:
    backgroundColor: "{colors.surface-warm}"
    textColor: "{colors.on-surface}"

  panel-subtle:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-surface-secondary}"

  metadata:
    backgroundColor: "{colors.surface-warm}"
    textColor: "{colors.on-surface-muted}"

  divider-strong:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.outline-strong}"

  focus-ring:
    backgroundColor: "{colors.primary-strong}"

  dialog-scrim:
    backgroundColor: "{colors.scrim}"

  transparent-control:
    backgroundColor: "{colors.transparent}"

  feedback-success:
    backgroundColor: "{colors.success-container}"
    textColor: "{colors.success}"

  feedback-warning:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.warning}"

  feedback-danger:
    backgroundColor: "{colors.danger-container}"
    textColor: "{colors.danger}"
---

## Overview

**Kate Blanc Warm Utility**는 고객에게는 차분하고 신뢰할 수 있는 상담 경험을,
관리자에게는 빠르고 명확한 업무 화면을 제공한다. 장식보다 정보 위계와 상태
구분을 우선하며, 모바일에서도 데스크톱과 같은 핵심 결과를 낼 수 있어야 한다.

기본 인상은 다음 세 단어로 정의한다.

- **Warm:** 샴페인 골드와 웜화이트를 사용하되 과도하게 장식하지 않는다.
- **Clear:** 현재 상태, 다음 행동, 오류 복구 방법을 한눈에 알 수 있게 한다.
- **Operational:** 관리자 화면은 예쁜 대시보드보다 실제 상담 업무 완료를 우선한다.

## Colors

### 브랜드 색

- `primary`는 주요 행동, 선택 상태, 고객 메시지처럼 시선이 필요한 곳에 사용한다.
- `primary-strong`은 hover, active, 작은 강조선에 제한한다.
- `primary-soft`는 선택 배경과 배지처럼 낮은 강도의 강조에 사용한다.
- Primary 위 텍스트는 흰색이 아니라 `on-primary`를 사용한다. 기존 흰색과 골드
  조합은 충분한 명암 대비를 확보하지 못한다.

### 표면과 텍스트

- 기본 페이지는 `surface-warm`, 카드와 dialog는 `surface`를 사용한다.
- 본문은 `on-surface`, 설명은 `on-surface-secondary`를 사용한다.
- `on-surface-muted`는 비필수 메타데이터에만 사용하며 작은 본문이나 필수 안내에
  사용하지 않는다.

### 상태 색

- 성공, 경고, 위험 색은 의미 전달용이다. 브랜드 강조색 대용으로 사용하지 않는다.
- 색만으로 상태를 구분하지 않고 아이콘, 레이블 또는 설명을 함께 제공한다.
- 위험 버튼은 삭제·영구 변경 같은 비가역 행동에만 사용한다.

## Typography

- 브랜드성 제목에는 Cormorant Garamond를 제한적으로 사용한다.
- 제품 UI, 관리자 화면, 폼, 표는 Pretendard로 통일한다.
- 기본 본문은 15px이며 업무상 중요한 텍스트를 13px 아래로 줄이지 않는다.
- 12px caption은 날짜, 보조 메타데이터 등 읽지 않아도 작업이 가능한 정보에만 쓴다.
- 본문 line-height는 최소 1.5를 유지한다.

## Layout

### 간격

- 모든 신규 레이아웃은 4px 기반 spacing token을 사용한다.
- 1~3px 값은 border와 focus offset처럼 의미가 다른 토큰에만 두고 spacing에는 넣지 않는다.
- 화면 외곽은 모바일 16px, 태블릿 이상 24~32px를 기본으로 한다.
- 카드 내부는 기본 24px이며 작은 모바일 카드만 16px까지 줄일 수 있다.

### 반응형 기준

- 360px: 소형 모바일에서 모든 핵심 고객·관리자 업무를 완료할 수 있어야 한다.
- 768px: 목록과 상세, drawer와 dialog의 태블릿 전환점을 검증한다.
- 1024px: 고정 sidebar와 표가 수평 overflow를 만들지 않아야 한다.
- 1440px: 콘텐츠 폭이 과도하게 늘어나지 않도록 읽기 폭과 업무 패널 폭을 제한한다.

Breakpoint 숫자는 구현 목표가 아니라 검증 기준이다. 콘텐츠가 깨지는 지점을 기준으로
CSS를 작성하고 위 viewport에서 결과를 검증한다.

구현의 반응형 숫자는 `x-breakpoints`를 정본으로 사용하며 토큰 생성기의 drift 검사로
CSS의 미디어 쿼리와 일치 여부를 확인한다.

## Elevation & Depth

- 기본 surface는 border로 구분하고 그림자는 최소화한다.
- dialog, mobile drawer, 떠 있는 알림만 낮은 shadow를 사용할 수 있다.
- 선택 상태를 그림자만으로 표현하지 않는다.
- 중첩 modal은 만들지 않는다.

## Shapes

- 입력과 작은 버튼은 `rounded.sm`을 사용한다.
- 카드와 채팅 bubble은 `rounded.md`를 사용한다.
- dialog와 큰 sheet만 `rounded.lg`를 사용한다.
- badge 외에는 pill 형태를 남용하지 않는다.

## Components

### Buttons

- 한 화면의 primary button은 원칙적으로 하나다.
- icon-only button은 시각적 tooltip과 접근 가능한 이름을 모두 제공한다.
- 최소 터치 영역은 44×44px다.
- loading 중에는 중복 실행을 막되 버튼 폭이 바뀌지 않게 한다.

### Forms

- label, 설명, 오류는 해당 입력과 프로그램적으로 연결한다.
- 오류 요약은 첫 오류로 이동할 수 있어야 한다.
- placeholder를 label 대신 사용하지 않는다.
- focus ring을 제거하지 않는다.
- 최소 터치 영역과 focus ring 치수는 `x-accessibility`를 사용한다.

### Dialogs

- dialog는 제목, modal role, focus trap, Escape 닫기, 닫은 뒤 focus 복귀를 제공한다.
- 모바일 가상 키보드가 열린 상태에서도 현재 입력과 제출 버튼이 보여야 한다.
- destructive action은 대상과 결과를 문장으로 확인한다.

### Lists and detail panes

- 데스크톱은 목록과 상세를 나란히 표시할 수 있다.
- 모바일은 목록과 상세를 별도 화면으로 전환하되 뒤로가기 위치를 유지한다.
- 모바일이라는 이유로 메모, 검색, 첨부, 난입 같은 핵심 기능을 숨기지 않는다.

### Feedback

- 모든 네트워크 화면은 loading, empty, error, retry 상태를 가진다.
- 저장 성공·실패, 새 메시지, 연결 상태는 적절한 live region으로 전달한다.
- toast만으로 복구가 필요한 오류를 전달하지 않는다.

## Do's and Don'ts

### Do

- 브랜드 골드는 선택과 주요 행동에 집중해서 사용한다.
- 정보 위계는 색보다 여백, 크기, 굵기로 먼저 만든다.
- 텍스트는 HTML 문자열이 아니라 안전한 텍스트 노드로 렌더링한다.
- 네트워크 호출은 승인된 단일 API client 경계에서만 수행하고 화면 컴포넌트에서는 직접 호출하지 않는다.
- 모바일과 키보드 사용자를 동일한 완료 조건으로 테스트한다.
- 공통 token과 primitive를 사용해 화면 간 상태 표현을 통일한다.

### Don't

- 관리자 화면에 별도의 보라색 primary 체계를 새로 추가하지 않는다.
- 골드 배경에 흰색 일반 텍스트를 사용하지 않는다.
- 10~11px 텍스트로 중요한 정보나 행동을 표시하지 않는다.
- 인라인 style, 인라인 event handler, 신규 전역 함수를 추가하지 않는다.
- 전역 객체 읽기는 인증 redirect 같은 플랫폼 연동에 한해 허용하되 전역 속성 쓰기나 API 노출은 하지 않는다.
- 고정 픽셀 높이 계산으로 검색바, 답장바, 첨부바를 겹쳐 쌓지 않는다.
- 모바일에서 기능을 `display: none`으로 제거하지 않는다.

## 소스

- `css/base.css`
- `css/admin.css`
- `css/chat.css`
- `admin.html`
- `chat.html`
- `quote.html`
- `plans/01-platform-modernization.md`
- `frontend/admin/src/styles/tokens.css`
- `frontend/admin/src/styles/admin.css`
