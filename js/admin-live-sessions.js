/* ================================================================
   admin-live-sessions.js — 라이브 세션 목록 + 폴링 (Stage 4-3: 분리)

   - 백그라운드 폴링 (5초): 라이브 탭 밖에서도 알림 뱃지 유지
   - 라이브 폴링 (1초): 라이브 탭에서 빠른 갱신
   - fetchLiveSessions: 활성 세션 가져와 렌더
   - renderLiveSessionList: 좌측 목록 렌더 (라이브 + 저장 통합)
   - liveGoBack, selectSavedConvInPanel (window.* 노출)

   의존:
   - admin-state.js: _cachedConversations, _liveSelectedByClick, setLiveSelectedByClick,
     _selectedSavedConvId, setSelectedSavedConvId
   - admin-config.js: SERVER, adminHeaders, escAdmin, escAttr, timeSince,
     serverOnline, getConvLabel, liveSelectedId, liveAdminMode, livePollTimer,
     liveMsgPollTimer, bgPollTimer, historyBgPollTimer, convPollTimer
   - admin-live.js (런타임): _seenMsgCounts, _getSeenSessions, _saveSeenCount,
     markSessionSeen, loadAdminSettings, _seenCountsLoaded, _loadSeenCounts,
     selectLiveSession, fetchLiveSessionMsgs, renderLiveChatPanel
   - admin-dashboard.js: checkHistoryCount, fetchDashboardConversations, renderDashboardSessions
   - admin-notifications.js: _checkLiveNotifications
   - admin.js: openHistoryDetail, switchTab, loadQuotes

   admin.html 로드 순서: ... notifications → dashboard → live-sessions → live → ...
================================================================ */

/**
 * 백그라운드 세션 카운트 폴링 (항상 실행, 5초마다)
 * — 라이브 탭 밖에서도 새 손님 알림 뱃지 유지
 */
function startBgPolling() {
  if (bgPollTimer) return;
  // 이미 로드된 경우 재로드 생략 (서버 저장 지연 시 메모리 최신값이 덮어쓰여지는 것 방지)
  if (!_seenCountsLoaded) _loadSeenCounts();
  loadAdminSettings();
  // 저장된 상담 미확인 카운트 — 60초마다 독립 실행
  if (!historyBgPollTimer) {
    checkHistoryCount();
    historyBgPollTimer = setInterval(checkHistoryCount, 60000);
  }
  // 대시보드 저장된 상담 목록 — 30초마다 갱신
  fetchDashboardConversations();
  if (!convPollTimer) {
    convPollTimer = setInterval(fetchDashboardConversations, 30000);
  }
  bgPollTimer = setInterval(async () => {

    // 백그라운드 탭에선 폴링 스킵 — 모바일 배터리·서버 부하 감소
    if (typeof document !== 'undefined' && document.hidden) return;

    // ── 오프라인이면 재연결 시도 (Render.com 절전 복귀 대응) ──
    if (!serverOnline) {
      try {
        const r = await fetch(`${SERVER}/api/health`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return;
        serverOnline = true;
        document.getElementById('serverBadge').className    = 'server-badge online';
        document.getElementById('serverStatus').textContent = '서버 연결됨';
        await loadQuotes();
      } catch { return; }
    }

    // ── 세션 카운트 확인 → 라이브 탭 뱃지 + 대시보드 업데이트 ──
    try {
      const res = await fetch(`${SERVER}/api/admin/sessions`, { headers: adminHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const sessions = data.sessions || [];
      const count       = sessions.length;
      const activeCount = sessions.filter(s => (s.messageCount ?? 0) > 0).length;
      const unreadCount = sessions.filter(s => s.id && !_getSeenSessions().has(String(s.id))).length;
      const badge   = document.getElementById('liveBadge');
      const countEl = document.getElementById('liveCount');
      if (badge) { badge.style.display = activeCount > 0 ? 'inline' : 'none'; badge.textContent = activeCount; }
      if (countEl) countEl.textContent  = count + '개 세션';
      // 대시보드도 업데이트
      _checkLiveNotifications(sessions);
      if (typeof window._checkNotifications === 'function') window._checkNotifications(sessions);
      renderDashboardSessions(sessions);
      const dashDot   = document.getElementById('dashDot');
      const dashCount = document.getElementById('dashCount');
      if (dashDot)   dashDot.style.background = count > 0 ? '#22c55e' : '#d1d5db';
      if (dashCount) dashCount.textContent = count + '개 진행 중';
    } catch { /* 무시 */ }

  }, 5000);
}

function stopBgPolling() {
  clearInterval(bgPollTimer);
  bgPollTimer = null;
  clearInterval(convPollTimer);
  convPollTimer = null;
  // historyBgPollTimer는 의도적으로 유지 — 탭과 무관하게 항상 실행
}

/**
 * 라이브 세션 목록 폴링 시작 (탭 진입 시) — 1초 간격
 */
function startLivePolling() {
  if (livePollTimer) return;
  stopBgPolling(); // live 탭에선 빠른 폴링이 대신함
  fetchLiveSessions();
  livePollTimer = setInterval(fetchLiveSessions, 1000);
  // 대화 탭 진입 시 저장된 대화 즉시 로드 (캐시 없을 때 대비)
  if (_cachedConversations.length === 0) fetchDashboardConversations();
}

/**
 * 라이브 세션 목록 폴링 중단 (탭 이탈 시) — 백그라운드 폴링으로 전환
 */
function stopLivePolling() {
  clearInterval(livePollTimer);
  clearInterval(liveMsgPollTimer);
  livePollTimer        = null;
  liveMsgPollTimer     = null;
  liveSelectedId       = null;
  setSelectedSavedConvId(null);
  liveAdminMode        = false;
  setLiveSelectedByClick(false);
  startBgPolling(); // 탭 이탈 후에도 알림 뱃지 유지
}

/**
 * 서버에서 활성 세션 목록을 가져와 렌더링
 */
async function fetchLiveSessions() {
  if (!serverOnline) return;
  // 백그라운드 탭에선 폴링 스킵
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const res = await fetch(`${SERVER}/api/admin/sessions`, { headers: adminHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const sessions = data.sessions || [];
    renderLiveSessionList(sessions);

    /* ── 세션 자동 선택 ── */
    if (sessions.length > 0 && !liveSelectedId && !_selectedSavedConvId) {
      /* 아직 선택된 세션 없고 저장 상담도 안 보고 있으면 가장 최근 세션 자동 선택 */
      selectLiveSession(sessions[0].id);
    } else if (liveSelectedId && !sessions.find(s => String(s.id) === String(liveSelectedId))) {
      /* 선택했던 세션이 사라졌으면 다음 세션으로 전환 */
      liveSelectedId = null;
      if (sessions.length > 0) selectLiveSession(sessions[0].id);
    }
  } catch { /* 무시 */ }
}

/**
 * 세션 목록 렌더링
 */
function renderLiveSessionList(sessions) {
  _checkLiveNotifications(sessions);
  const container  = document.getElementById('liveSessionList');
  const dot        = document.getElementById('liveDot');
  const countEl    = document.getElementById('liveCount');
  // 활성 라이브 세션과 같은 session_id의 저장 상담은 중복 표시 방지
  const activeLiveSessionIds = new Set(sessions.filter(s => s.id).map(s => String(s.id)));
  const savedConvs = (_cachedConversations || [])
    .filter(c => !activeLiveSessionIds.has(String(c.session_id)))
    .slice(0, 50);
  const totalCount = sessions.length + savedConvs.length;

  if (dot) dot.style.background = sessions.length > 0 ? '#22c55e' : '#d1d5db';
  if (countEl) countEl.textContent = sessions.length > 0
    ? `${sessions.length}개 진행 중`
    : `대화 ${savedConvs.length}개`;

  if (totalCount === 0) {
    if (container) container.innerHTML = `
      <div style="text-align:center;padding:40px 16px;color:#9ca3af;font-size:13px;">
        <div style="font-size:32px;margin-bottom:12px;">💤</div>
        아직 대화가 없습니다
      </div>`;
    renderDashboardSessions(sessions);
    return;
  }

  // 라이브 탭 배지 (다른 탭에서 볼 때) — 실제로 채팅 시작한 세션만 카운트
  const currentTab = document.querySelector('.tab-btn.active')?.id;
  const activeSessions = sessions.filter(s => (s.messageCount ?? 0) > 0).length;
  if (currentTab !== 'tab-live' && activeSessions > 0) {
    const badge = document.getElementById('liveBadge');
    if (badge) { badge.style.display = 'inline'; badge.textContent = activeSessions; }
  }

  if (!container) { renderDashboardSessions(sessions); return; }
  const seenNow = _getSeenSessions();

  // ── 진행 중인 세션 ──
  const liveHtml = sessions.map(s => {
    const isSelected = String(s.id) === String(liveSelectedId);
    const isAdmin    = s.mode === 'admin';
    const sid        = String(s.id);
    const lastSeen   = _seenMsgCounts[sid];
    const msgCount0  = s.messageCount ?? 0;
    const isNewRaw   = s.id && !seenNow.has(sid);
    const hasNewMsg  = !isNewRaw && lastSeen !== undefined && msgCount0 > lastSeen;
    const isNew      = isNewRaw || hasNewMsg;
    const ago        = timeSince(new Date(s.lastMessageAt));
    const msgCount   = s.messageCount ?? 0;
    return `
      <div data-session-id="${escAttr(s.id)}"
        onclick="selectLiveSession('${escAttr(s.id)}',true)"
        style="padding:12px 14px;border-radius:10px;cursor:pointer;margin-bottom:6px;
          border:2px solid ${isSelected ? '#7c3aed' : '#e5e7eb'};
          background:${isSelected ? '#faf5ff' : '#fff'};transition:all .15s;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:18px;position:relative;display:inline-block;">👤<span style="position:absolute;bottom:0;right:-1px;width:8px;height:8px;background:#22c55e;border-radius:50%;border:1.5px solid #fff;"></span></span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;">
              ${escAdmin(s.customerName)}
              <button type="button" title="이름 수정" class="js-rename-btn" data-kind="session" data-id="${escAttr(s.id)}" data-name="${escAttr(s.customerName||'')}" style="background:transparent;border:none;color:#9ca3af;font-size:11px;cursor:pointer;padding:0 2px;line-height:1;">✏️</button>
              ${isNew ? '<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:#ef4444;color:#fff;font-weight:700;">NEW</span>' : ''}
              ${s.isTest ? '<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:#fef3c7;color:#92400e;font-weight:700;">테스트</span>' : ''}
            </div>
            <div style="font-size:11px;color:#9ca3af;">${[s.region, s.layout, `💬 ${msgCount}개`].filter(Boolean).join(' · ') || `💬 ${msgCount}개 메시지`}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            ${isNew && msgCount > 0 ? `<span class="new-badge" style="background:#ef4444;color:#fff;font-size:11px;font-weight:700;padding:1px 7px;border-radius:10px;min-width:20px;text-align:center;">${msgCount}</span>` : ''}
            <button type="button" title="진행 중 대화 삭제 (테스트 정리)"
              onclick="deleteLiveSessionFromDash('${escAttr(s.id)}', event)"
              style="background:transparent;border:none;color:#9ca3af;font-size:14px;cursor:pointer;padding:2px 4px;border-radius:4px;line-height:1;"
              onmouseover="this.style.background='#fee2e2';this.style.color='#dc2626'"
              onmouseout="this.style.background='transparent';this.style.color='#9ca3af'">🗑</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
          <span>💬 ${msgCount}개 메시지</span><span>${ago}</span>
        </div>
        ${s.tokens ? `<div style="margin-top:5px;font-size:11px;color:#7c3aed;font-weight:600;">🪙 ₩${s.tokens.costKRW.toLocaleString()} · ${s.tokens.totalTokens.toLocaleString()}토큰</div>` : ''}
      </div>`;
  }).join('');

  // ── 이전 대화 (실시간 자동 기록됨) ──
  const savedSorted = [...savedConvs].sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at));
  const savedHtml = savedSorted.map(c => {
    const isSelected = String(_selectedSavedConvId) === String(c.id);
    const label      = getConvLabel(c);
    const timeStr    = c.saved_at ? timeSince(new Date(c.saved_at)) : '';
    const sub        = [c.region, c.layout, `💬 ${c.message_count || 0}개`].filter(Boolean).join(' · ');
    const isNew      = !seenNow.has(String(c.id));
    return `
      <div data-conv-id="${escAttr(c.id)}"
        onclick="selectSavedConvInPanel('${escAttr(c.id)}')"
        style="padding:12px 14px;border-radius:10px;cursor:pointer;margin-bottom:6px;
          border:2px solid ${isSelected ? '#7c3aed' : '#e5e7eb'};
          background:${isSelected ? '#faf5ff' : '#fff'};transition:all .15s;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:18px;">👤</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:${isNew ? '700' : '600'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;">
              ${escAdmin(label)}
              <button type="button" title="이름 수정" class="js-rename-btn" data-kind="conversation" data-id="${escAttr(c.id)}" data-name="${escAttr(label)}" style="background:transparent;border:none;color:#9ca3af;font-size:11px;cursor:pointer;padding:0 2px;line-height:1;">✏️</button>
              ${isNew ? '<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:#ef4444;color:#fff;font-weight:700;">NEW</span>' : ''}
            </div>
          </div>
          <span style="font-size:11px;color:#9ca3af;flex-shrink:0;white-space:nowrap;">${timeStr}</span>
        </div>
        <div style="font-size:11px;color:#9ca3af;padding-left:26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escAdmin(sub)}</div>
      </div>`;
  }).join('');

  container.innerHTML = liveHtml + savedHtml;

  // 토큰 맵 갱신
  for (const s of sessions) {
    if (s.tokens) { window._liveTokenMap = window._liveTokenMap || {}; window._liveTokenMap[s.id] = s.tokens; }
  }

  renderDashboardSessions(sessions);
}

window.liveGoBack = function() {
  document.querySelector('.live-split')?.classList.remove('session-selected');
  clearInterval(liveMsgPollTimer);
  liveMsgPollTimer     = null;
  liveSelectedId       = null;
  setSelectedSavedConvId(null);
};

/**
 * 완료된 대화 선택 — 오른쪽 패널에 저장된 메시지 표시
 */
window.selectSavedConvInPanel = function(convId) {
  clearInterval(liveMsgPollTimer);
  liveMsgPollTimer     = null;
  liveSelectedId       = null;
  setSelectedSavedConvId(convId);

  // _saveSeenCount 먼저 호출 — markSessionSeen에서 0 저장 제거 후 호출자 책임
  // String 변환 — c.id가 lumane schema에서 bigint(숫자)일 때 string convId와 매칭되도록
  const conv = _cachedConversations.find(c => String(c.id) === String(convId));
  if (!conv) return;  // early return 먼저 — conv 없으면 이후 패널 렌더링 불가
  _saveSeenCount(String(convId), conv.message_count ?? 0);
  markSessionSeen(convId);

  const label   = getConvLabel(conv);
  const timeStr = conv.saved_at
    ? new Date(conv.saved_at).toLocaleString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
    : '-';

  // 패널 헤더 세팅
  document.getElementById('livePanelTitle').textContent = `📁 ${label}`;
  document.getElementById('livePanelMeta').textContent  =
    `${timeStr} · 메시지 ${conv.message_count || 0}개${conv.region ? ' · ' + conv.region : ''}`;
  document.getElementById('livePanelActions').innerHTML = `
    <button onclick="openHistoryDetail('${escAttr(convId)}')"
      style="padding:5px 12px;background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;cursor:pointer;white-space:nowrap;">
      📋 상세보기
    </button>`;

  // 라이브 전용 UI 숨기기
  const replyBar = document.getElementById('adminReplyBar');
  if (replyBar) replyBar.style.display = 'none';
  const adminInputArea = document.getElementById('adminInputArea');
  if (adminInputArea) adminInputArea.style.display = 'none';

  // 메시지 렌더링 — renderLiveChatPanel 재사용
  const messages    = Array.isArray(conv.messages) ? conv.messages : [];
  const fakeSession = { id: conv.id, customerName: label, messages, mode: 'ai', tokens: null };
  renderLiveChatPanel(fakeSession);

  // renderLiveChatPanel이 덮어쓴 헤더/액션 다시 적용
  document.getElementById('livePanelTitle').textContent = `📁 ${label}`;
  document.getElementById('livePanelMeta').textContent  =
    `${timeStr} · 메시지 ${conv.message_count || 0}개${conv.region ? ' · ' + conv.region : ''}`;
  document.getElementById('livePanelActions').innerHTML = `
    <button onclick="openHistoryDetail('${escAttr(convId)}')"
      style="padding:5px 12px;background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;cursor:pointer;white-space:nowrap;">
      📋 상세보기
    </button>`;
  if (replyBar) replyBar.style.display = 'none';
  if (adminInputArea) adminInputArea.style.display = 'none';

  const msgs = document.getElementById('liveMsgs');
  if (msgs) requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });

  // 목록 선택 하이라이트 갱신
  renderLiveSessionList(_cachedLiveSessions);

  // 모바일: 채팅 패널 전환
  if (window.innerWidth < 768) {
    document.querySelector('.live-split')?.classList.add('session-selected');
    setTimeout(() => { if (msgs) msgs.scrollTop = msgs.scrollHeight; }, 50);
  }
};
