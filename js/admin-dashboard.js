/* ================================================================
   admin-dashboard.js — 어드민 대시보드 (Stage 4-2: admin-live.js에서 분리)

   - 대시보드 카드 렌더링 (라이브 + 저장 통합 리스트)
   - 미확인 필터 / 유입 소스 통계 / 상담 삭제
   - 미확인 뱃지 / 히스토리 카운트 갱신
   - options_text·size_raw 파싱 헬퍼

   의존:
   - admin-state.js: _cachedConversations, _cachedLiveSessions,
     _unreadOnlyMode, setUnreadOnlyMode, setCachedConversations
   - admin-config.js: SERVER, adminHeaders, escAdmin, escAttr,
     timeSince, serverOnline, getConvLabel
   - admin-live.js (런타임 호출):
     _seenMsgCounts, _resetSessions, _seenCountsLoaded, _getSeenSessions,
     _saveSeenCount, markSessionSeen, getAdminSetting, saveAdminSetting,
     selectLiveSession, switchTab, updateHistoryBadge,
     openHistoryDetail (admin.js)

   admin.html 로드 순서: config → state → notifications → dashboard → live → ...
================================================================ */

/**
 * 저장된 상담 미확인 건수 확인 (60초마다 백그라운드 실행)
 */
async function checkHistoryCount() {
  if (!serverOnline) return;
  /* 대시보드 탭에 있으면 lastSeenHistoryAt 갱신 (저장된 상담이 대시보드에 통합됨) */
  if (document.querySelector('.tab-btn.active')?.id === 'tab-dashboard') {
    updateHistoryBadge(0);
    const el = document.getElementById('statUnread');
    const card = el?.closest('.stats-card--unread');
    if (el) el.textContent = 0;
    if (card) card.classList.add('no-unread');
    return;
  }
  try {
    const res = await fetch(`${SERVER}/api/admin/conversations`, { headers: adminHeaders() });
    if (!res.ok) return;
    // await 이후 탭 상태 재확인 (race condition 방지)
    if (document.querySelector('.tab-btn.active')?.id === 'tab-dashboard') return;
    const data = await res.json();
    const conversations = data.conversations || [];
    let lastSeenAt = getAdminSetting('lastSeenHistoryAt');
    if (!lastSeenAt) {
      lastSeenAt = new Date().toISOString();
      saveAdminSetting('lastSeenHistoryAt', lastSeenAt);
    }
    const seenDate = new Date(lastSeenAt);
    const unread = conversations.filter(c => c.saved_at && new Date(c.saved_at) > seenDate).length;
    if (typeof updateHistoryBadge === 'function') updateHistoryBadge(unread);
    const el = document.getElementById('statUnread');
    const card = el?.closest('.stats-card--unread');
    if (el) el.textContent = unread;
    if (card) card.classList.toggle('no-unread', unread === 0);
  } catch { /* 무시 */ }
}

function goToUnreadHistory() {
  switchTab('dashboard');
  setUnreadOnlyMode(true); // 항상 ON 고정. 끄기는 배너 [전체 보기] 버튼으로만.
  renderDashboardSessions(_cachedLiveSessions);
  setTimeout(() => {
    document.getElementById('dashboardSessionList')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
}
function clearUnreadFilter() {
  setUnreadOnlyMode(false);
  renderDashboardSessions(_cachedLiveSessions);
}
window.clearUnreadFilter = clearUnreadFilter;

/* ── 유입 소스 통계 — 클라이언트 캐시(C) + 프리워밍(A') ──
   period → { data, expiresAt }. TTL 60초 (서버 5분 캐시와 함께 빠른 첫 클릭/재진입 보장) */
const _srcStatsCache = new Map();
const _SRC_STATS_CLIENT_TTL = 60 * 1000;
const _SRC_PERIODS = ['today', 'week', 'month', 'all'];

async function _fetchSrcStats(period) {
  /* 캐시 히트 */
  const cached = _srcStatsCache.get(period);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  /* 네트워크 */
  const res = await fetch(`${SERVER}/api/admin/source-stats?period=${encodeURIComponent(period)}`, { headers: adminHeaders() });
  if (!res.ok) throw new Error(res.status);
  const data = await res.json();
  _srcStatsCache.set(period, { data, expiresAt: Date.now() + _SRC_STATS_CLIENT_TTL });
  return data;
}

function _renderSrcStats(listEl, data) {
  if (!data.counts || data.counts.length === 0) {
    listEl.innerHTML = '<div style="color:#9ca3af;font-size:13px;">데이터 없음</div>';
    return;
  }
  const total = data.total || 0;
  listEl.innerHTML = `
    <div style="font-size:12px;color:#9ca3af;margin-bottom:8px;">총 방문 ${total}건</div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${data.counts.map(({ src, count }) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return `
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="min-width:80px;font-size:13px;font-weight:600;color:#111827;">${escAdmin(src)}</div>
            <div style="flex:1;height:8px;background:#f3f4f6;border-radius:4px;overflow:hidden;">
              <div style="height:100%;background:#7c3aed;width:${pct}%;"></div>
            </div>
            <div style="min-width:60px;text-align:right;font-size:12px;color:#374151;">${count}명 (${pct}%)</div>
          </div>`;
      }).join('')}
    </div>`;
}

/* ── 유입 소스 통계 로드/렌더링 ── */
async function loadSourceStats(period = 'today') {
  // 기간 버튼 활성화 토글
  document.querySelectorAll('#srcPeriodBtns button').forEach(b => {
    const active = b.dataset.period === period;
    b.style.background = active ? '#7c3aed' : '#fff';
    b.style.color      = active ? '#fff' : '#374151';
    b.style.borderColor = active ? '#7c3aed' : '#d1d5db';
  });
  const listEl = document.getElementById('sourceStatsList');
  if (!listEl) return;
  /* 캐시 히트 시 '로딩 중…' 깜빡임 없이 즉시 렌더 */
  const cached = _srcStatsCache.get(period);
  if (cached && cached.expiresAt > Date.now()) {
    _renderSrcStats(listEl, cached.data);
    return;
  }
  listEl.textContent = '로딩 중…';
  try {
    const data = await _fetchSrcStats(period);
    _renderSrcStats(listEl, data);
  } catch (err) {
    listEl.innerHTML = `<div style="color:#dc2626;font-size:12px;">로드 실패: ${escAdmin(err.message)}</div>`;
  }
}
window.loadSourceStats = loadSourceStats;

/* A' — 어드민 첫 로드 시 4개 기간 병렬 프리워밍 (백그라운드, UI 영향 없음) */
function prewarmSourceStats() {
  _SRC_PERIODS.forEach(p => { _fetchSrcStats(p).catch(() => {}); });
}
window.prewarmSourceStats = prewarmSourceStats;
/* 스크립트 로드 시 자동 발동 — 어드민이 켜지자마자 백그라운드로 캐시 채움 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', prewarmSourceStats);
} else {
  prewarmSourceStats();
}

/* ── 대시보드에서 저장 상담 삭제 ── */
async function deleteSavedConvFromDash(id, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  if (!id) return;
  if (!confirm('이 상담 기록을 삭제하시겠습니까? 복구할 수 없습니다.')) return;
  try {
    const res = await fetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: adminHeaders(),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.status); }
    setCachedConversations(_cachedConversations.filter(c => String(c.id) !== String(id)));
    renderDashboardSessions(_cachedLiveSessions);
    if (typeof showToast === 'function') showToast('상담 기록이 삭제됐습니다.', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(`삭제 실패: ${err.message}`, 'error');
    else alert(`삭제 실패: ${err.message}`);
  }
}
window.deleteSavedConvFromDash = deleteSavedConvFromDash;

/* ── 대시보드에서 라이브(진행 중) 세션 즉시 삭제 (테스트 정리용) ── */
async function deleteLiveSessionFromDash(sessionId, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  if (!sessionId) return;
  if (!confirm('이 진행 중인 대화를 삭제하시겠습니까? 메모리·DB 모두에서 제거됩니다.')) return;
  try {
    const res = await fetch(`${SERVER}/api/admin/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE', headers: adminHeaders(),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.status); }
    // 캐시에서 즉시 제거 + 재렌더
    setCachedLiveSessions(_cachedLiveSessions.filter(s => String(s.id) !== String(sessionId)));
    setCachedConversations(_cachedConversations.filter(c => String(c.session_id) !== String(sessionId)));
    renderDashboardSessions(_cachedLiveSessions);
    if (typeof showToast === 'function') showToast('진행 중 대화가 삭제됐습니다.', 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(`삭제 실패: ${err.message}`, 'error');
    else alert(`삭제 실패: ${err.message}`);
  }
}
window.deleteLiveSessionFromDash = deleteLiveSessionFromDash;

/* ── options_text 파싱 ("기본행거 66cm: 70,000원 / 이불장: 200,000원" → 배열) ── */
function _parseOptionsItems(optText) {
  if (!optText) return [];
  return optText.split(' / ').map(item => {
    const m = item.match(/^(.+?):\s*([\d,]+)원/);
    if (m) return { name: m[1].trim(), price: parseInt(m[2].replace(/,/g, ''), 10) };
    return { name: item.trim(), price: null };
  }).filter(i => i.name);
}

/* ── size_raw 포맷 ("좌측 660 정면 041 우측 655" → "660 × 041 × 655") ── */
function _formatSizeRaw(raw) {
  if (!raw) return null;
  const m = raw.match(/좌측\s*([\d.]+)\s*정면\s*([\d.]+)\s*우측\s*([\d.]+)/);
  if (m) return `${m[1]} × ${m[2]} × ${m[3]}`;
  return raw;
}

async function fetchDashboardConversations() {
  if (!serverOnline) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const res = await fetch(`${SERVER}/api/admin/conversations`, { headers: adminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    setCachedConversations((data.conversations || []).slice(0, 30));
    _refreshDashBadge();
    _checkConvNotifications();
    renderDashboardSessions(_cachedLiveSessions);
  } catch { /* 무시 */ }
}

function _refreshDashBadge() {
  // 책갈피(seen-counts) 로드 전에는 카운트 계산 보류 — 잘못된 미확인 표시 방지
  if (!_seenCountsLoaded) return;
  const seen    = _getSeenSessions();
  const liveNew = _cachedLiveSessions.filter(s => {
    if (!s.id) return false;
    if (!seen.has(String(s.id)) || _resetSessions.has(String(s.id))) return true;
    const lastSeen = _seenMsgCounts[String(s.id)];
    return lastSeen !== undefined && (s.messageCount ?? 0) > lastSeen;
  }).length;
  // 활성 라이브 세션과 같은 session_id의 저장 상담은 중복 카운트 방지
  const activeLive = new Set(_cachedLiveSessions.filter(s => s.id).map(s => String(s.id)));
  const convNew = _cachedConversations.filter(c => c.id && !seen.has(String(c.id)) && !activeLive.has(String(c.session_id))).length;
  const total   = liveNew + convNew;
  [document.getElementById('dashNewBadge'), document.getElementById('sidebarDashBadge')].forEach(badge => {
    if (!badge) return;
    badge.textContent = total;
    badge.style.display = total > 0 ? 'inline' : 'none';
  });
  // 미확인 상담 stat 카드 동기화 (탭 뱃지와 동일 기준)
  const statUnread = document.getElementById('statUnread');
  const statCard   = statUnread?.closest('.stats-card--unread');
  if (statUnread) statUnread.textContent = total;
  if (statCard)   statCard.classList.toggle('no-unread', total === 0);
  const liveBadge = document.getElementById('liveBadge');
  if (liveBadge) {
    const activeCount = _cachedLiveSessions.filter(s => (s.messageCount ?? 0) > 0).length;
    liveBadge.textContent = activeCount;
    liveBadge.style.display = activeCount > 0 ? 'inline' : 'none';
  }
}

function renderDashboardSessions(sessions) {
  const container = document.getElementById('dashboardSessionList');
  if (!container) return;

  // 이벤트 위임 — 최초 1회만 등록
  if (!container._clickInited) {
    container._clickInited = true;
    container.addEventListener('click', e => {
      const sessionCard = e.target.closest('[data-session-id]');
      const convCard    = e.target.closest('[data-conv-id]');
      if (sessionCard) {
        const sessionId = sessionCard.dataset.sessionId;
        const sess = _cachedLiveSessions.find(s => s.id === sessionId);
        if (sess) _saveSeenCount(sessionId, sess.messageCount ?? 0);
        _resetSessions.delete(sessionId);
        markSessionSeen(sessionId);
        switchTab('live');
        setTimeout(() => selectLiveSession(sessionId, true), 100);
      } else if (convCard) {
        const convId = convCard.dataset.convId;
        // 저장 상담도 message_count 포함해서 저장 (0 저장 방지)
        const conv = _cachedConversations.find(c => String(c.id) === String(convId));
        if (conv) _saveSeenCount(convId, conv.message_count ?? 0);
        markSessionSeen(convId);
        if (typeof openHistoryDetail === 'function') openHistoryDetail(convId);
      }
    });
    container.addEventListener('mouseenter', e => {
      const card = e.target.closest('[data-session-id],[data-conv-id]');
      if (card) card.style.boxShadow = '0 4px 16px rgba(0,0,0,.1)';
    }, true);
    container.addEventListener('mouseleave', e => {
      const card = e.target.closest('[data-session-id],[data-conv-id]');
      if (card) card.style.boxShadow = 'none';
    }, true);
  }

  setCachedLiveSessions(sessions);
  _refreshDashBadge();

  // 서버 읽음 데이터 첫 로드 후 테이블이 비어있으면 현재 모든 세션을 읽음 처리 (초기화)
  if (_seenCountsLoaded && Object.keys(_seenMsgCounts).length === 0) {
    sessions.forEach(s => { if (s.id) _saveSeenCount(s.id, s.messageCount ?? 0); });
    (_cachedConversations || []).forEach(c => { if (c.id) _saveSeenCount(c.id, c.message_count ?? 0); });
  }

  const seenSessions = _getSeenSessions();

  // 베이스라인 초기화만 수행 (세션 리셋 자동 감지는 비활성 — 잘못된 미확인 표시 방지)
  sessions.forEach(s => {
    if (!s.id) return;
    const msgCount = s.messageCount ?? 0;
    const sid = String(s.id);
    if (seenSessions.has(sid) && _seenMsgCounts[sid] === undefined && !_resetSessions.has(sid)) {
      _seenMsgCounts[sid] = msgCount;
    }
  });

  if (sessions.length === 0 && _cachedConversations.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 16px;color:#9ca3af;">
        <div style="font-size:48px;margin-bottom:16px;">💤</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px;">들어온 상담이 없습니다</div>
        <div style="font-size:13px;">고객이 채팅을 시작하면 여기에 표시됩니다</div>
      </div>`;
    return;
  }

  // ── 라이브 + 저장 합쳐서 최신순 단일 리스트 ──
  const liveItems = sessions.filter(s => s.id).map(s => ({
    type: 'live', id: s.id,
    sortTime: (() => { const t = new Date(s.lastMessageAt).getTime(); return isNaN(t) ? 0 : t; })(),
    data: s
  }));
  // 활성 라이브 세션과 같은 session_id의 저장 상담은 중복 표시 방지
  const activeLiveSessionIds = new Set(sessions.filter(s => s.id).map(s => String(s.id)));
  const convItems = _cachedConversations
    .filter(c => c.id && !activeLiveSessionIds.has(String(c.session_id)))
    .map(c => ({
      type: 'saved', id: c.id,
      sortTime: (() => { const t = new Date(c.saved_at).getTime(); return isNaN(t) ? 0 : t; })(),
      data: c
    }));
  let allItems = [...liveItems, ...convItems].sort((a, b) => b.sortTime - a.sortTime);

  // 미확인만 보기 필터 적용
  if (_unreadOnlyMode) {
    allItems = allItems.filter(item => {
      if (item.type === 'live') {
        const s = item.data;
        const sid = String(s.id);
        const msgCount = s.messageCount ?? 0;
        const isNew = !seenSessions.has(sid) || _resetSessions.has(sid);
        const lastSeen = _seenMsgCounts[sid];
        const hasNewMsg = !isNew && lastSeen !== undefined && msgCount > lastSeen;
        return isNew || hasNewMsg;
      }
      return !seenSessions.has(String(item.id));
    });
  }

  const filterBanner = _unreadOnlyMode
    ? `<div style="display:flex;align-items:center;justify-content:space-between;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:10px 14px;margin-bottom:10px;">
        <span style="font-size:13px;font-weight:600;color:#c2410c;">🔴 미확인만 보기 (${allItems.length}건)</span>
        <button onclick="clearUnreadFilter()" style="font-size:12px;padding:4px 10px;border:1px solid #fdba74;border-radius:6px;background:#fff;color:#c2410c;cursor:pointer;font-weight:600;">전체 보기</button>
      </div>`
    : '';

  if (_unreadOnlyMode && allItems.length === 0) {
    container.innerHTML = filterBanner + `
      <div style="text-align:center;padding:60px 16px;color:#9ca3af;">
        <div style="font-size:48px;margin-bottom:16px;">✅</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:6px;">미확인 상담이 없습니다</div>
        <div style="font-size:13px;">모두 확인했습니다.</div>
      </div>`;
    return;
  }

  container.innerHTML = filterBanner + allItems.map(item => {
    if (item.type === 'live') {
      const s        = item.data;
      const isAdmin  = s.mode === 'admin';
      const ago      = timeSince(new Date(s.lastMessageAt));
      const msgCount = s.messageCount ?? 0;
      const sid      = String(s.id);
      const isNew    = !seenSessions.has(sid) || _resetSessions.has(sid);
      const lastSeen = _seenMsgCounts[sid];
      const hasNewMsg = !isNew && lastSeen !== undefined && msgCount > lastSeen;
      const unread   = isNew || hasNewMsg;
      const unreadCount = isNew ? msgCount : (hasNewMsg ? msgCount - lastSeen : 0);
      const subText  = s.tokens
        ? `🪙 ₩${s.tokens.costKRW.toLocaleString()} · ${s.tokens.totalTokens.toLocaleString()}토큰`
        : `💬 ${msgCount}개 메시지`;
      return `
        <div data-session-id="${escAttr(s.id)}"
          style="background:#fff;border:2px solid ${(isNew||hasNewMsg)?'#fecaca':'#dbeafe'};border-left:5px solid ${(isNew||hasNewMsg)?'#ef4444':'#3b82f6'};border-radius:14px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;margin-bottom:8px;transition:background .12s;"
          onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background='#fff'">
          <div style="position:relative;flex-shrink:0;">
            <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#6b7280,#9ca3af);display:flex;align-items:center;justify-content:center;font-size:22px;">
              👤
            </div>
            <div style="position:absolute;bottom:1px;right:1px;width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid #fff;"></div>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
              <div style="display:flex;align-items:center;gap:5px;">
                <span style="font-size:15px;font-weight:${unread?'700':'600'};color:#111827;">${escAdmin(s.customerName)}</span>
                <button type="button" title="이름 수정" class="js-rename-btn" data-kind="session" data-id="${escAttr(s.id)}" data-name="${escAttr(s.customerName||'')}" style="background:transparent;border:none;color:#9ca3af;font-size:11px;cursor:pointer;padding:0 2px;line-height:1;">✏️</button>
                ${s.startedAt ? `<span style="font-size:11px;color:#9ca3af;font-weight:500;" title="첫 상담 시각">${new Date(s.startedAt).toLocaleTimeString('ko-KR', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' })}</span>` : ''}
                <span style="font-size:11px;padding:1px 6px;border-radius:6px;background:#f3f4f6;color:#4b5563;font-weight:600;">${escAdmin(s.src || '직접방문')}</span>
                ${s.isTest ? '<span style="font-size:10px;padding:1px 5px;border-radius:6px;background:#fef3c7;color:#92400e;font-weight:700;">테스트</span>' : ''}
                ${!s.isTest && s.isReturning ? '<span style="font-size:10px;padding:1px 5px;border-radius:6px;background:#d1fae5;color:#065f46;font-weight:700;">재방문</span>' : ''}
                ${!s.isTest && !s.isReturning ? '<span style="font-size:10px;padding:1px 5px;border-radius:6px;background:#e0f2fe;color:#0369a1;font-weight:700;">첫방문</span>' : ''}
              </div>
              <span style="font-size:11px;color:#9ca3af;flex-shrink:0;margin-left:8px;">${ago}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;min-width:0;">
              <span style="font-size:12px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;">${subText}</span>
              ${unreadCount > 0 ? `<span style="flex-shrink:0;margin-left:6px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;min-width:20px;text-align:center;">${unreadCount}</span>` : ''}
            </div>
          </div>
          <button type="button" title="진행 중 대화 삭제 (테스트 정리)"
            onclick="deleteLiveSessionFromDash('${escAttr(s.id)}', event)"
            style="flex-shrink:0;background:transparent;border:none;color:#9ca3af;font-size:16px;cursor:pointer;padding:4px 6px;border-radius:6px;line-height:1;"
            onmouseover="this.style.background='#fee2e2';this.style.color='#dc2626'"
            onmouseout="this.style.background='transparent';this.style.color='#9ca3af'">🗑</button>
        </div>`;
    } else {
      const c      = item.data;
      const isNew  = !seenSessions.has(String(c.id));
      const timeStr = c.saved_at
        ? new Date(c.saved_at).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '-';

      // options_text에서 항목+가격 파싱 ("기본행거 66cm: 70,000원 / 이불장: 200,000원" 형식)
      const optItems = _parseOptionsItems(c.options_text);
      const sizeStr  = _formatSizeRaw(c.size_raw);

      const infoField = (label, val) =>
        val ? `<div style="display:flex;gap:4px;font-size:12px;"><span style="color:#6b7280;flex-shrink:0;white-space:nowrap;">${label}</span><span style="color:#111827;font-weight:600;">${escAdmin(val)}</span></div>` : '';

      const infoRows = [
        infoField('연락처', c.phone),
        infoField('설치지역', c.region),
        infoField('공간', sizeStr),
        infoField('프레임', c.frame_color),
        infoField('선반색', c.shelf_color),
      ].filter(Boolean);

      // options_text에 가격이 없는 경우 단순 텍스트로 fallback
      const optionsSimple = c.options_text && optItems.every(i => i.price === null)
        ? c.options_text : null;

      return `
        <div data-conv-id="${escAttr(c.id)}"
          style="background:#fff;border:2px solid ${isNew?'#fecaca':'#dbeafe'};border-left:5px solid ${isNew?'#ef4444':'#3b82f6'};border-radius:14px;padding:14px 16px;cursor:pointer;margin-bottom:8px;transition:background .12s;"
          onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background='#fff'">

          <!-- 헤더 -->
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:${infoRows.length>0||optItems.length>0?'10px':'0'};">
            <div style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6b7280,#9ca3af);display:flex;align-items:center;justify-content:center;font-size:22px;">👤</div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <span style="font-size:15px;font-weight:${isNew?'700':'600'};color:#111827;">${escAdmin(getConvLabel(c))}</span>
                <button type="button" title="이름 수정" class="js-rename-btn" data-kind="conversation" data-id="${escAttr(c.id)}" data-name="${escAttr(getConvLabel(c))}" style="background:transparent;border:none;color:#9ca3af;font-size:11px;cursor:pointer;padding:0 2px;line-height:1;">✏️</button>
                <span style="font-size:11px;padding:1px 6px;border-radius:6px;background:#f3f4f6;color:#4b5563;font-weight:600;">${escAdmin(c.src || '직접방문')}</span>
                ${c.layout ? `<span style="font-size:11px;padding:1px 6px;border-radius:6px;background:#ede9fe;color:#7c3aed;font-weight:600;">${escAdmin(c.layout)}</span>` : ''}
                ${c.is_test ? '<span style="font-size:10px;padding:1px 5px;border-radius:6px;background:#fef3c7;color:#92400e;font-weight:700;">테스트</span>' : ''}
                ${isNew ? '<span style="font-size:10px;padding:1px 5px;border-radius:6px;background:#ef4444;color:#fff;font-weight:700;">NEW</span>' : ''}
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:1px;">${timeStr} · 💬 ${c.message_count||0}개</div>
            </div>
            ${c.estimated_price ? `<div style="font-size:13px;font-weight:700;color:#d97706;flex-shrink:0;">${Number(c.estimated_price).toLocaleString()}원</div>` : ''}
            <button type="button" title="삭제"
              onclick="deleteSavedConvFromDash('${escAttr(c.id)}', event)"
              style="flex-shrink:0;background:transparent;border:none;color:#9ca3af;font-size:16px;cursor:pointer;padding:4px 6px;border-radius:6px;line-height:1;"
              onmouseover="this.style.background='#fee2e2';this.style.color='#dc2626'"
              onmouseout="this.style.background='transparent';this.style.color='#9ca3af'">🗑</button>
          </div>

          <!-- 정보 그리드 -->
          ${infoRows.length > 0 ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;font-size:12px;margin-bottom:${optItems.length>0||optionsSimple?'8px':'0'};">
            ${infoRows.join('')}
          </div>` : ''}

          <!-- 옵션 단순 텍스트 -->
          ${optionsSimple ? `<div style="font-size:12px;color:#111827;margin-bottom:6px;"><span style="color:#6b7280;">옵션</span> ${escAdmin(optionsSimple)}</div>` : ''}

          <!-- 예상 단가 테이블 -->
          ${optItems.length > 0 && optItems.some(i => i.price !== null) ? `
          <div style="background:#fffbeb;border-radius:8px;padding:8px 10px;margin-top:4px;">
            <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:5px;">💰 예상 단가 (참고용)</div>
            ${optItems.filter(i=>i.price!==null).map(i=>`
              <div style="display:flex;justify-content:space-between;font-size:12px;color:#111827;margin-bottom:2px;">
                <span>${escAdmin(i.name)}</span>
                <span style="font-weight:600;">${Number(i.price).toLocaleString()}원</span>
              </div>`).join('')}
            ${c.estimated_price ? `
            <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:#92400e;margin-top:5px;border-top:1px solid #fde68a;padding-top:5px;">
              <span>합계 (참고)</span>
              <span>${Number(c.estimated_price).toLocaleString()}원</span>
            </div>
            <div style="font-size:10px;color:#b45309;margin-top:2px;">배송비 별도 · 도면 확정 전 기준</div>` : ''}
          </div>` : ''}
        </div>`;
    }
  }).join('');
}
