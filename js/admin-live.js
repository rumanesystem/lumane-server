/* ================================================================
   라이브 상담 기능 — 실시간 세션 난입
================================================================ */


/* ── 어드민 공유 설정 (서버 저장) ── */
const _adminSettings = {};
async function loadAdminSettings() {
  try {
    const res = await adminFetch('/api/admin/settings', { headers: adminHeaders() });
    if (!res.ok) return;
    const { settings } = await res.json();
    Object.assign(_adminSettings, settings);
    // 기존 localStorage 마이그레이션 (1회)
    const migrate = { lastSeenHistoryAt: true, lastSeenQuotesAt: true, lumane_admin_templates: true };
    for (const key of Object.keys(migrate)) {
      const val = localStorage.getItem(key);
      if (val && _adminSettings[key] === undefined) {
        const parsed = key === 'lumane_admin_templates' ? JSON.parse(val) : val;
        saveAdminSetting(key, parsed);
      }
      localStorage.removeItem(key);
    }
  } catch {}
}
function saveAdminSetting(key, value) {
  _adminSettings[key] = value;
  adminFetch('/api/admin/settings', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ key, value })
  }).catch(() => {});
}
function getAdminSetting(key) { return _adminSettings[key]; }
window.saveAdminSetting = saveAdminSetting;
window.getAdminSetting  = getAdminSetting;

/* ── 세션별 마지막으로 읽은 메시지 수 추적 (서버 저장) ── */
const _seenMsgCounts = {};
function _getSeenSessions() {
  return new Set(Object.keys(_seenMsgCounts));
}
async function _loadSeenCounts() {
  try {
    const res = await adminFetch('/api/admin/seen-counts', { headers: adminHeaders() });
    if (!res.ok) return;
    const { counts } = await res.json();
    Object.assign(_seenMsgCounts, counts);
    // 기존 localStorage 마이그레이션 (1회)
    const oldKey = 'lumane_seen_sessions';
    const oldRaw = localStorage.getItem(oldKey);
    if (oldRaw) {
      const oldIds = JSON.parse(oldRaw);
      if (Array.isArray(oldIds) && oldIds.length > 0) {
        for (const id of oldIds) {
          if (_seenMsgCounts[id] === undefined) _saveSeenCount(id, 0);
        }
      }
      localStorage.removeItem(oldKey);
      localStorage.removeItem('lumane_seen_counts');
    }
    setSeenCountsLoaded(true);
    // 카운트 로드 완료 후 캐시된 데이터로 대시보드 재렌더링
    if (_cachedLiveSessions.length > 0 || _cachedConversations.length > 0) {
      renderDashboardSessions(_cachedLiveSessions, _cachedConversations);
    }
    _refreshDashBadge();
  } catch {}
}
function _saveSeenCount(sessionId, count) {
  const id = String(sessionId);
  _seenMsgCounts[id] = count;
  adminFetch('/api/admin/seen-counts', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ session_id: id, count })
  })
    .then(r => { if (!r.ok) console.warn('[seen-counts] 저장 실패:', r.status, id, count); })
    .catch(err => console.warn('[seen-counts] 저장 네트워크 오류:', err.message, id, count));
}
/* ── 서버 재시작 등으로 세션이 리셋된 경우 추적 ── */
const _resetSessions = new Set();
function markSessionSeen(sessionId) {
  if (!sessionId) return;
  const id = String(sessionId);
  // _seenMsgCounts[id]가 undefined일 때 0으로 저장하던 코드 제거 —
  // 0 저장 시 이후 모든 메시지가 hasNewMsg=true로 잡혀 잘못된 미확인 표시 유발.
  // 호출자가 _saveSeenCount(id, currentCount)로 정확한 값 저장 책임.
  _refreshDashBadge();
  // 미확인만 보기 필터 활성 시, 읽음 처리된 카드 즉시 사라지도록 재렌더링
  if (_unreadOnlyMode) {
    setTimeout(() => renderDashboardSessions(_cachedLiveSessions), 0);
  }
  // 실시간 세션 카드 즉시 업데이트
  const sessionCard = document.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`);
  if (sessionCard) {
    sessionCard.style.borderColor = '#3b82f6';
    sessionCard.querySelector('.new-badge')?.remove();
    const enterBtn = sessionCard.querySelector('.enter-btn');
    if (enterBtn) enterBtn.style.color = '#3b82f6';
  }
  // 저장된 상담 카드 즉시 업데이트
  const convCard = document.querySelector(`[data-conv-id="${CSS.escape(sessionId)}"]`);
  if (convCard) {
    convCard.style.borderColor = '#3b82f6';
    convCard.querySelector('.new-badge')?.remove();
    const detailBtn = convCard.querySelector('.detail-btn');
    if (detailBtn) detailBtn.style.color = '#3b82f6';
  }
}
window.markSessionSeen   = markSessionSeen;
window._getSeenSessions  = _getSeenSessions;

/* ================================================================
   빠른 답변 템플릿 (서버 저장)
================================================================ */
function loadTemplates() {
  const t = getAdminSetting('lumane_admin_templates');
  return Array.isArray(t) ? t : [];
}

function saveTemplatesToStorage(list) {
  saveAdminSetting('lumane_admin_templates', list);
}

function renderTemplateList() {
  const panel = document.getElementById('templateList');
  if (!panel) return;
  const templates = loadTemplates();
  if (templates.length === 0) {
    panel.innerHTML = `<div style="font-size:12px;color:#9ca3af;padding:4px 4px;">템플릿이 없습니다. "+ 추가/편집"을 눌러 추가하세요.</div>`;
    return;
  }
  panel.innerHTML = templates.map((t, i) => `
    <button onclick="applyTemplate(${i})"
      style="text-align:left;padding:8px 12px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;font-size:13px;color:#374151;cursor:pointer;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
      onmouseenter="this.style.background='#f3f4f6'" onmouseleave="this.style.background='#fff'">
      ${escAdmin(t)}
    </button>
  `).join('');
}

function applyTemplate(idx) {
  const templates = loadTemplates();
  const text = templates[idx];
  if (!text) return;
  const input = document.getElementById('liveInput');
  if (!input || input.disabled) { showToast('난입 후 사용 가능합니다', 'info'); return; }
  input.value = text;
  input.focus();
  refreshAdminSendBtn();
  toggleTemplatePanel(false);
}

function toggleTemplatePanel(forceClose) {
  const panel = document.getElementById('templatePanel');
  if (!panel) return;
  const isOpen = panel.style.display === 'flex' || panel.style.display === 'block';
  if (forceClose === false || isOpen) {
    panel.style.display = 'none';
  } else {
    renderTemplateList();
    panel.style.display = 'block';
  }
}

function openTemplateEditor() {
  const overlay = document.getElementById('templateEditorOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  renderTemplateEditorList();
}

function closeTemplateEditor(e) {
  if (e && e.target !== document.getElementById('templateEditorOverlay')) return;
  document.getElementById('templateEditorOverlay').style.display = 'none';
}

function renderTemplateEditorList() {
  const container = document.getElementById('templateEditorList');
  if (!container) return;
  const templates = loadTemplates();
  container.innerHTML = templates.map((t, i) => `
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="text" value="${escAttr(t)}" data-idx="${i}"
        style="flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:inherit;outline:none;"
        placeholder="자주 쓰는 문구를 입력하세요">
      <button onclick="removeTemplateItem(${i})"
        style="flex-shrink:0;background:none;border:none;color:#ef4444;font-size:16px;cursor:pointer;padding:4px 6px;">🗑</button>
    </div>
  `).join('');
}

function addTemplateItem() {
  const container = document.getElementById('templateEditorList');
  if (!container) return;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;align-items:center;';
  const idx = container.children.length;
  div.innerHTML = `
    <input type="text" data-idx="${idx}"
      style="flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:inherit;outline:none;"
      placeholder="자주 쓰는 문구를 입력하세요">
    <button onclick="this.parentElement.remove()"
      style="flex-shrink:0;background:none;border:none;color:#ef4444;font-size:16px;cursor:pointer;padding:4px 6px;">🗑</button>
  `;
  container.appendChild(div);
  div.querySelector('input').focus();
}

function removeTemplateItem(idx) {
  const templates = loadTemplates();
  templates.splice(idx, 1);
  saveTemplatesToStorage(templates);
  renderTemplateEditorList();
}

function saveTemplates() {
  const inputs = document.querySelectorAll('#templateEditorList input[type="text"]');
  const templates = [...inputs].map(i => i.value.trim()).filter(Boolean);
  saveTemplatesToStorage(templates);
  document.getElementById('templateEditorOverlay').style.display = 'none';
  renderTemplateList();
  showToast('✅ 템플릿 저장 완료', 'success');
}

/* ── 시간 포맷 유틸 ─────────────────────────────── */
function timeSince(date) {
  const diff = Math.floor((Date.now() - date) / 1000);
  if (diff < 60)   return diff + '초 전';
  if (diff < 3600) return Math.floor(diff / 60) + '분 전';
  return Math.floor(diff / 3600) + '시간 전';
}
