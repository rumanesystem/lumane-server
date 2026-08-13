/* ================================================================
   Admin 설정값 & 전역 상태 & 공통 유틸
================================================================ */

// 관리자 API는 인증 쿠키가 적용되는 same-origin 경로만 사용합니다.
const SERVER = '';

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie.split('; ').find(cookie => cookie.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : '';
}

/** Admin API 공통 헤더 */
function adminHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const csrfToken = readCookie('lumane_admin_csrf');
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return headers;
}

async function logoutAdmin() {
  try {
    await fetch('/api/admin-auth/logout', { method: 'POST', headers: adminHeaders() });
  } finally {
    window.location.replace('/admin');
  }
}
window.logoutAdmin = logoutAdmin;

let adminAuthRedirecting = false;
let adminHealthTimer = null;
let adminSessionTimer = null;
let adminUpdateTimer = null;

function stopAdminActivity() {
  for (const timer of [
    livePollTimer,
    liveMsgPollTimer,
    bgPollTimer,
    historyBgPollTimer,
    convPollTimer,
    adminHealthTimer,
    adminSessionTimer,
    adminUpdateTimer,
  ]) {
    if (timer) clearInterval(timer);
  }
  livePollTimer = null;
  liveMsgPollTimer = null;
  bgPollTimer = null;
  historyBgPollTimer = null;
  convPollTimer = null;
  adminHealthTimer = null;
  adminSessionTimer = null;
  adminUpdateTimer = null;
  serverOnline = false;
}

function redirectToAdminLogin() {
  if (adminAuthRedirecting) return;
  adminAuthRedirecting = true;
  stopAdminActivity();
  window.location.replace('/admin');
}

function isAdminAuthActive() {
  return !adminAuthRedirecting;
}

function isProtectedAdminRequest(input) {
  const rawUrl = typeof input === 'string' ? input : input?.url;
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin) return false;
    return url.pathname === '/api/admin'
      || url.pathname.startsWith('/api/admin/')
      || url.pathname === '/api/quotes'
      || url.pathname.startsWith('/api/quotes/')
      || url.pathname === '/api/summarize';
  } catch {
    return false;
  }
}

async function adminFetch(input, init) {
  if (!isAdminAuthActive()) {
    return new Response(null, { status: 401, statusText: 'Unauthorized' });
  }
  const response = await fetch(input, init);
  if (response.status === 401 && isProtectedAdminRequest(input)) {
    redirectToAdminLogin();
  }
  return response;
}

async function verifyAdminSession() {
  try {
    const response = await fetch('/api/admin-auth/session', { credentials: 'same-origin' });
    if (response.ok) return true;
    if (response.status === 401) redirectToAdminLogin();
    return false;
  } catch {
    // 일시적인 네트워크 오류는 기존 온라인 상태 표시가 처리한다.
    return false;
  }
}
window.verifyAdminSession = verifyAdminSession;
window.stopAdminActivity = stopAdminActivity;
window.adminFetch = adminFetch;
window.isAdminAuthActive = isAdminAuthActive;

/* ── 전역 상태 ── */
let currentQuoteId  = null;   // 현재 열린 견적 ID
let serverOnline    = false;  // 서버 온라인 여부
let allQuotes       = [];     // 전체 견적 데이터
let lastQuoteCount  = 0;      // 마지막으로 확인한 견적 수 (새 알림용)

// 라이브 상담 상태
let liveSelectedId   = null;   // 현재 선택된 세션 ID
let liveAdminMode    = false;  // 현재 난입 중인지
let livePollTimer    = null;   // 세션 목록 폴링 타이머
let liveMsgPollTimer = null;   // 선택된 세션 메시지 폴링 타이머
let bgPollTimer      = null;   // 백그라운드 세션 카운트 폴링 타이머 (탭 무관 항상 실행)
let historyBgPollTimer = null; // 저장된 상담 미확인 카운트 폴링 타이머 (60초 간격)
let convPollTimer    = null;   // 대시보드 저장된 상담 목록 폴링 타이머 (30초 간격)


/* ================================================================
   공통 유틸 함수 (모든 모듈에서 사용)
================================================================ */

/**
 * 화면 상단에 토스트 알림을 표시합니다
 */
function showToast(msg, type = 'default') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * ISO 날짜 문자열을 읽기 좋은 형식으로 변환합니다
 */
function formatDate(isoStr, full = false) {
  if (!isoStr) return '-';

  const d = new Date(isoStr);
  const now = new Date();

  if (!full) {
    const diff  = now - d;
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);

    if (mins < 1)  return '방금 전';
    if (mins < 60) return `${mins}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7)   return `${days}일 전`;
  }

  return d.toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * HTML 본문 이스케이프 (텍스트 노드 삽입용)
 */
function escAdmin(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * HTML 속성값 이스케이프 (onclick, href 등 속성 안에 넣을 때 사용)
 */
function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 현재 필터 적용된 견적 목록 (exportExcel에서 사용) */
let filteredQuotes = null;

/**
 * summary 필드를 안전하게 파싱합니다 (문자열이면 JSON.parse, 객체면 그대로, 실패하면 null)
 */
function parseSummary(c) {
  try { return typeof c.summary === 'string' ? JSON.parse(c.summary) : (c.summary || null); } catch { return null; }
}

/**
 * 어드민 라벨(이름) 수정 헬퍼 — kind: 'conversation' | 'session'
 * 클릭 → prompt 인풋 → PATCH 호출 → 성공 시 화면 새로고침
 * (라이브=in-memory sess.customerName, 저장=DB conversations.customer_name)
 */
async function renameCustomer(kind, id, currentName, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  const input = prompt('새 이름을 입력하세요:', currentName || '');
  if (input === null) return; /* 취소 */
  const newName = input.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 40);
  if (!newName) { alert('이름이 비어있습니다.'); return; }
  if (newName === currentName) return;
  const url = kind === 'session'
    ? `${SERVER}/api/admin/sessions/${encodeURIComponent(id)}/name`
    : `${SERVER}/api/admin/conversations/${encodeURIComponent(id)}/name`;
  try {
    const res = await adminFetch(url, {
      method: 'PATCH',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    /* 화면 즉시 갱신 — 가벼운 새로고침 (라이브 폴링·dashboard 리렌더 한 번에 처리) */
    location.reload();
  } catch (err) {
    alert(`이름 변경 실패: ${err.message}`);
  }
}
window.renameCustomer = renameCustomer;

/* 이벤트 위임 — 카드가 동적 재렌더돼도 한 번 바인딩으로 항상 작동.
   인라인 onclick + JSON.stringify 패턴의 XSS 위험 제거 (data-* 는 단순 문자열만 보관) */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.js-rename-btn');
  if (!btn) return;
  renameCustomer(btn.dataset.kind, btn.dataset.id, btn.dataset.name || '', e);
});

/**
 * 저장된 상담 카드 표시 이름 생성
 * 우선순위: 실명 → summary.이름 → 지역+형태+옵션 조합 → 상담요약 앞부분 → 저장시각
 */
function getConvLabel(c) {
  if (c.customer_name && c.customer_name !== '고객') return c.customer_name;
  const s = parseSummary(c);
  if (s?.이름) return s.이름;
  const parts = [];
  if (s?.주소) parts.push(s.주소.split(' ')[0]);
  if (s?.드레스룸형태) parts.push(s.드레스룸형태);
  const opts = ['거울장','3단서랍','2단서랍','아일랜드장','악세사리장'].filter(k => s?.[k] === true);
  if (opts.length) parts.push(opts[0]);
  if (parts.length) return parts.join(' · ');
  if (s?.상담요약) return s.상담요약.slice(0, 18) + (s.상담요약.length > 18 ? '…' : '');
  return c.saved_at
    ? new Date(c.saved_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '(미확인)';
}
