/* ================================================================
   admin-mode.js — 어드민 난입 모드 + 검색 + 컨텍스트 메뉴
   (Stage 4-5: admin-live.js에서 분리 — 마지막 모듈)

   - 파일 첨부 / 이미지 라이트박스 / 파일 압축
   - 답장 바 / 입력 디바운스 / 붙여넣기
   - 검색 (Ctrl+F) — 매치 하이라이트·이동
   - 우클릭 컨텍스트 메뉴

   주요 함수:
   - initAdminFileUpload, compressImageIfNeeded, showAdminAttachBar,
     showAdminLightbox, clearAdminPendingFile, refreshAdminSendBtn
   - sendAdminTyping, initAdminPaste
   - showAdminReplyBar, clearAdminReplyBar
   - 검색: toggleAdminSearch, openAdminSearch, closeAdminSearch,
     initAdminSearch, runAdminSearch, stepAdminSearch, scrollToAdminMatch,
     clearAdminSearchHighlights, updateAdminSearchCount, escAdminReg
   - 컨텍스트 메뉴: closeAdminCtxMenu, initAdminCtxMenuListener

   의존:
   - admin-state.js: adminPendingFile, adminPendingObjectUrl,
     setAdminPendingFile, setAdminPendingObjectUrl, _typingTimer,
     setTypingTimer, _adminReplyContent, setAdminReplyContent,
     _adminCtxMenu, setAdminCtxMenu, _adminSearchMatches, _adminSearchIdx,
     _adminSearchOpen, setAdminSearchMatches, setAdminSearchIdx,
     setAdminSearchOpen
   - admin-config.js: SERVER, adminHeaders, escAdmin, escAttr, liveSelectedId,
     liveAdminMode
   - admin-live.js (런타임): saveConversationManual 등

   admin.html 로드 순서: ... live-messages → admin-mode → admin-live → ...
================================================================ */

/**
 * admin 파일 업로드 초기화 (페이지 로드 시 1회 실행)
 */
function initAdminFileUpload() {
  const input = document.getElementById('adminFileInput');
  if (!input) return;
  /* + 버튼으로 파일 선택 → 칩으로 표시 (전송은 전송 버튼에서) */
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    if (file.size > 10 * 1024 * 1024) {
      showToast('파일은 10MB 이하만 첨부 가능합니다', 'error');
      return;
    }
    showAdminAttachBar(file);
  });
}

/**
 * 대화 수동 저장
 */
async function saveConversationManual() {
  if (!liveSelectedId) {
    showToast('선택된 세션이 없습니다.', 'error');
    return;
  }
  try {
    const res = await adminFetch(`${SERVER}/api/admin/save-conversation`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ sessionId: liveSelectedId }),
    });
    if (!res.ok) {
      let detail = '';
      try { const d = await res.json(); detail = d.error || ''; } catch(_) {}
      // 세션 만료 시: 대화는 실시간 자동저장되어 있으므로 목록 갱신으로 확인
      if (detail === '세션 없음' || res.status === 404) {
        showToast('💾 자동 저장된 상담을 확인합니다.', 'success');
        await fetchDashboardConversations();
        renderDashboardSessions(_cachedLiveSessions);
        return;
      }
      throw new Error(detail || res.status);
    }
    showToast('💾 대화가 저장되었습니다.', 'success');
    await fetchDashboardConversations();
    renderDashboardSessions(_cachedLiveSessions);
  } catch (err) {
    showToast(`❌ 저장 실패: ${err.message}`, 'error');
  }
}

/**
 * 선택된 세션에 admin 난입
 */
async function takeoverSession() {
  if (!liveSelectedId) return;
  try {
    const res = await adminFetch(`${SERVER}/api/admin/takeover`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ sessionId: liveSelectedId }),
    });
    if (!res.ok) throw new Error();
    showToast('👩‍💼 난입 완료! 고객에게 직접 메시지를 보내세요.', 'success');
    fetchLiveSessionMsgs();
  } catch {
    showToast('❌ 난입에 실패했습니다', 'error');
  }
}

/**
 * 선택된 세션을 AI에게 반환
 */
async function releaseSession() {
  if (!liveSelectedId) return;
  try {
    const res = await adminFetch(`${SERVER}/api/admin/release`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ sessionId: liveSelectedId }),
    });
    if (!res.ok) throw new Error();
    showToast('🤖 AI에게 다시 넘겼습니다.', 'success');
    fetchLiveSessionMsgs();
  } catch {
    showToast('❌ 처리에 실패했습니다', 'error');
  }
}

/* ── 이미지 자동 압축 (admin용, ui.js와 동일 로직) ── */
async function compressImageIfNeeded(file) {
  if (!file.type.startsWith('image/')) return file;
  if (file.size < 300 * 1024) return file;
  return new Promise(resolve => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      const MAX = 1920;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) { const r = Math.min(MAX/w, MAX/h); w=Math.round(w*r); h=Math.round(h*r); }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob(blob => {
        if (!blob || blob.size >= file.size) { resolve(file); return; }
        const ext = mime === 'image/png' ? 'png' : 'jpg';
        const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.' + ext;
        resolve(new File([blob], name, { type: mime }));
      }, mime, 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(file); };
    img.src = blobUrl;
  });
}

/* ── admin 첨부 칩 상태 ── */
window._failedImgUrls = new Set(); // 404 이미지 URL 캐시 — 폴링 재요청 방지
window._downloadImg = async function(url) {
  try {
    const res  = await fetch(url);
    const blob = await res.blob();
    const a    = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const ext  = blob.type === 'image/png' ? 'png' : 'jpg';
    a.download = `드레스룸_예시.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

function fmtLiveTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const h = d.getHours(), m = d.getMinutes();
    return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(m).padStart(2, '0')}`;
  } catch { return ''; }
}
async function showAdminAttachBar(rawFile) {
  const file = await compressImageIfNeeded(rawFile);
  setAdminPendingFile(file);
  if (adminPendingObjectUrl) URL.revokeObjectURL(adminPendingObjectUrl);
  setAdminPendingObjectUrl(URL.createObjectURL(file));

  const bar = document.getElementById('adminAttachBar');
  if (!bar) return;

  const isImg = file.type.startsWith('image/');
  bar.innerHTML = (isImg
    ? `<img src="${escAttr(adminPendingObjectUrl)}" id="adminAttachThumb" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;flex-shrink:0;cursor:zoom-in;" alt="" title="클릭하면 크게 보기">`
    : `<span style="font-size:22px;flex-shrink:0;">📎</span>`) +
    `<span style="font-size:12px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;">${escAdmin(file.name || 'screenshot.png')}</span>
     <button id="adminAttachRemove" style="flex-shrink:0;background:none;border:none;font-size:14px;color:#9ca3af;cursor:pointer;padding:4px 6px;border-radius:6px;">✕</button>`;

  bar.style.display = 'flex';

  if (isImg) {
    document.getElementById('adminAttachThumb').addEventListener('click', () => {
      showAdminLightbox(adminPendingObjectUrl);
    });
  }

  document.getElementById('adminAttachRemove').addEventListener('click', () => {
    clearAdminPendingFile();
    document.getElementById('liveInput')?.focus();
  });
  refreshAdminSendBtn();
}

function showAdminLightbox(src) {
  if (!src) return;
  document.getElementById('adminLightbox')?.remove();
  const lb = document.createElement('div');
  lb.id = 'adminLightbox';
  lb.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px;';
  lb.innerHTML = `<img src="${escAttr(src)}" style="max-width:100%;max-height:100%;border-radius:10px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.6);">`;
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}

function clearAdminPendingFile() {
  if (adminPendingObjectUrl) { URL.revokeObjectURL(adminPendingObjectUrl); setAdminPendingObjectUrl(null); }
  setAdminPendingFile(null);
  const bar = document.getElementById('adminAttachBar');
  if (bar) bar.style.display = 'none';
  refreshAdminSendBtn();
}

function refreshAdminSendBtn() {
  const btn   = document.getElementById('liveSendBtn');
  const input = document.getElementById('liveInput');
  if (!btn) return;
  const active = liveAdminMode && liveSelectedId && (input?.value.trim() || adminPendingFile);
  btn.disabled = !active;
  btn.style.opacity = active ? '1' : '0.45';
}

/**
 * admin → 고객 메시지 전송
 */
async function sendAdminMsg() {
  const input  = document.getElementById('liveInput');
  let text     = input?.value.trim() || '';
  const hasPending = !!adminPendingFile;
  if ((!text && !hasPending) || !liveSelectedId || !liveAdminMode) return;

  /* 답장 인용 텍스트 앞에 붙이기 */
  if (_adminReplyContent && text) {
    const roleLabel = ''; // 서버에 그냥 텍스트로 전송 (UI에서만 구분)
    const preview   = _adminReplyContent.length > 40 ? _adminReplyContent.slice(0, 40) + '…' : _adminReplyContent;
    text = `[답장: ${preview}]\n${text}`;
  }
  clearAdminReplyBar();
  clearTimeout(_typingTimer);
  sendAdminTyping(false);

  input.value    = '';
  input.disabled = true;
  refreshAdminSendBtn();

  try {
    /* 첨부 파일 먼저 전송 */
    if (hasPending) {
      const file = adminPendingFile;
      clearAdminPendingFile();
      showToast('업로드 중...', 'info');
      const name = file.name && file.name !== 'image.png' ? file.name : `screenshot-${Date.now()}.png`;
      const fd   = new FormData();
      fd.append('file', file, name);
      const up = await fetch(`${SERVER}/api/upload`, { method: 'POST', body: fd });
      if (!up.ok) throw new Error('upload');
      const upData = await up.json();
      if (!upData.success) throw new Error('upload');
      const fullUrl    = upData.url.startsWith('http') ? upData.url : `${location.origin}${upData.url}`;
      const msgContent = upData.isImage ? `[이미지]\n${fullUrl}` : `[파일: ${name}]\n${fullUrl}`;
      const res = await adminFetch(`${SERVER}/api/admin/message`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ sessionId: liveSelectedId, message: msgContent }),
      });
      if (!res.ok) throw new Error('send');
      showToast('✅ 이미지 전송 완료', 'success');
    }

    /* 텍스트 전송 */
    if (text) {
      const res = await adminFetch(`${SERVER}/api/admin/message`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ sessionId: liveSelectedId, message: text }),
      });
      if (!res.ok) throw new Error('send');
    }

    await fetchLiveSessionMsgs();
  } catch {
    showToast('❌ 메시지 전송 실패', 'error');
  } finally {
    input.disabled = false;
    input.focus();
    refreshAdminSendBtn();
  }
}

/**
 * admin 입력창 Ctrl+V 이미지 붙여넣기 → 칩 방식
 */
/* ── 타이핑 상태 전송 ── */
function sendAdminTyping(isTyping) {
  if (!liveSelectedId) return;
  adminFetch(`${SERVER}/api/admin/typing`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ sessionId: liveSelectedId, typing: isTyping }),
  }).catch(() => {});
}

function initAdminPaste() {
  const input = document.getElementById('liveInput');
  if (!input) return;

  input.addEventListener('input', () => {
    refreshAdminSendBtn();
    // 타이핑 중 → true 전송, 2초 뒤 멈추면 false
    sendAdminTyping(true);
    clearTimeout(_typingTimer);
    setTypingTimer(setTimeout(() => sendAdminTyping(false), 2000));
  });

  input.addEventListener('paste', (e) => {
    const items     = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) showAdminAttachBar(file);
  });
}

/* ── admin 답장 바 ── */
function showAdminReplyBar(role, content) {
  setAdminReplyContent(content);
  const bar     = document.getElementById('adminReplyBar');
  const label   = document.getElementById('adminReplyLabel');
  const preview = document.getElementById('adminReplyPreview');
  if (!bar) return;
  const roleLabel = role === 'user' ? '고객' : role === 'admin' ? '담당자' : 'AI';
  label.textContent   = roleLabel + '에게 답장';
  preview.textContent = content.length > 60 ? content.slice(0, 60) + '…' : content;
  bar.style.display = 'flex';
  document.getElementById('liveInput')?.focus();
}

function clearAdminReplyBar() {
  setAdminReplyContent(null);
  const bar = document.getElementById('adminReplyBar');
  if (bar) bar.style.display = 'none';
}

/* ── admin 채팅 검색 ── */
function toggleAdminSearch() {
  _adminSearchOpen ? closeAdminSearch() : openAdminSearch();
}

function openAdminSearch() {
  setAdminSearchOpen(true);
  const bar = document.getElementById('adminSearchBar');
  if (bar) { bar.style.display = 'flex'; }
  document.getElementById('adminSearchInput')?.focus();
}

function closeAdminSearch() {
  setAdminSearchOpen(false);
  clearAdminSearchHighlights();
  setAdminSearchMatches([]);
  setAdminSearchIdx(-1);
  const bar = document.getElementById('adminSearchBar');
  if (bar) bar.style.display = 'none';
  const inp = document.getElementById('adminSearchInput');
  if (inp) inp.value = '';
  updateAdminSearchCount(0, 0);
}

function initAdminSearch() {
  const inp  = document.getElementById('adminSearchInput');
  const prev = document.getElementById('adminSearchPrev');
  const next = document.getElementById('adminSearchNext');
  const cls  = document.getElementById('adminSearchClose');
  if (!inp) return;
  inp.addEventListener('input', () => runAdminSearch(inp.value.trim()));
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); stepAdminSearch(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') closeAdminSearch();
  });
  prev?.addEventListener('click', () => stepAdminSearch(-1));
  next?.addEventListener('click', () => stepAdminSearch(1));
  cls?.addEventListener('click', closeAdminSearch);
}

function runAdminSearch(query) {
  clearAdminSearchHighlights();
  setAdminSearchMatches([]);
  setAdminSearchIdx(-1);
  if (!query) { updateAdminSearchCount(0, 0); return; }
  const bubbles = document.querySelectorAll('#liveMsgs [data-role]');
  const lq = query.toLowerCase();
  bubbles.forEach(row => {
    /* 텍스트 노드만 있는 bubble div 찾기 */
    const bubble = row.querySelector('div[style*="border-radius"]');
    if (!bubble) return;
    const text = bubble.textContent;
    if (!text.toLowerCase().includes(lq)) return;
    // TreeWalker로 텍스트 노드만 wrap — 링크 href·이미지 src 같은 속성값 깨짐 방지
    const re = new RegExp(escAdminReg(query), 'gi');
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let n; while ((n = walker.nextNode())) textNodes.push(n);
    textNodes.forEach(node => {
      if (!re.test(node.nodeValue)) { re.lastIndex = 0; return; }
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, match;
      while ((match = re.exec(node.nodeValue))) {
        if (match.index > last) frag.appendChild(document.createTextNode(node.nodeValue.slice(last, match.index)));
        const mark = document.createElement('mark');
        mark.className = 'admin-search-hl';
        mark.textContent = match[0];
        frag.appendChild(mark);
        last = match.index + match[0].length;
      }
      if (last < node.nodeValue.length) frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    bubble.querySelectorAll('.admin-search-hl').forEach(m => _adminSearchMatches.push(m));
  });
  updateAdminSearchCount(_adminSearchMatches.length > 0 ? 1 : 0, _adminSearchMatches.length);
  if (_adminSearchMatches.length > 0) { setAdminSearchIdx(0); scrollToAdminMatch(0); }
}

function stepAdminSearch(dir) {
  if (!_adminSearchMatches.length) return;
  _adminSearchMatches[_adminSearchIdx]?.classList.remove('admin-search-hl-active');
  setAdminSearchIdx((_adminSearchIdx + dir + _adminSearchMatches.length) % _adminSearchMatches.length);
  _adminSearchMatches[_adminSearchIdx]?.classList.add('admin-search-hl-active');
  scrollToAdminMatch(_adminSearchIdx);
  updateAdminSearchCount(_adminSearchIdx + 1, _adminSearchMatches.length);
}

function scrollToAdminMatch(idx) {
  _adminSearchMatches[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function clearAdminSearchHighlights() {
  document.querySelectorAll('#liveMsgs .admin-search-hl').forEach(el => {
    el.replaceWith(document.createTextNode(el.textContent));
  });
}

function updateAdminSearchCount(cur, total) {
  const el = document.getElementById('adminSearchCount');
  if (el) el.textContent = total > 0 ? `${cur} / ${total}` : (total === 0 && cur === 0 ? '결과없음' : '');
}

function escAdminReg(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── admin 메시지 우클릭 컨텍스트 메뉴 ── */
function closeAdminCtxMenu() {
  if (_adminCtxMenu) { _adminCtxMenu.remove(); setAdminCtxMenu(null); }
  document.removeEventListener('click', closeAdminCtxMenu, { once: true });
  document.removeEventListener('contextmenu', closeAdminCtxMenu, { once: true });
}

function showAdminCtxMenu(x, y, role, content) {
  closeAdminCtxMenu();

  const items = [
    { label: '📋 복사', action: 'copy' },
    { label: '↩ 답장', action: 'reply' },
  ];

  const menu = document.createElement('div');
  menu.style.cssText = `
    position:fixed;left:${x}px;top:${y}px;z-index:9990;
    background:#fff;border-radius:12px;
    box-shadow:0 4px 20px rgba(0,0,0,.18);
    border:1px solid rgba(0,0,0,.06);
    padding:5px 0;min-width:130px;
    animation:ctxFadeIn .1s ease;
  `;
  menu.innerHTML = items.map(it => `
    <button data-action="${it.action}" style="display:block;width:100%;padding:10px 15px;text-align:left;background:none;border:none;font-size:13.5px;color:#374151;cursor:pointer;white-space:nowrap;"
      onmouseenter="this.style.background='#f3f4f6'" onmouseleave="this.style.background='none'">
      ${it.label}
    </button>
  `).join('');

  /* 뷰포트 경계 보정 */
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  if (rect.right  > window.innerWidth  - 8) menu.style.left = (x - rect.width)  + 'px';
  if (rect.bottom > window.innerHeight - 8) menu.style.top  = (y - rect.height) + 'px';

  menu.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    closeAdminCtxMenu();
    if (action === 'copy') {
      navigator.clipboard.writeText(content).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = content; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      });
      showToast('✅ 복사됨', 'success');
    } else if (action === 'reply') {
      if (!liveAdminMode) { showToast('난입 후 답장 가능합니다', 'info'); return; }
      showAdminReplyBar(role, content);
    }
  });

  setAdminCtxMenu(menu);
  setTimeout(() => {
    document.addEventListener('click', closeAdminCtxMenu, { once: true });
    document.addEventListener('contextmenu', closeAdminCtxMenu, { once: true });
  }, 0);
}

/**
 * admin 라이브 채팅창 우클릭 이벤트 위임 초기화
 */
function initAdminCtxMenuListener() {
  const liveMsgs = document.getElementById('liveMsgs');
  if (!liveMsgs) return;
  liveMsgs.addEventListener('contextmenu', e => {
    const row = e.target.closest('.live-msg-row');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation(); // document 버블링 차단 → 연속 우클릭 정상 동작
    const role    = row.dataset.role;
    const content = decodeURIComponent(row.dataset.content || '');
    showAdminCtxMenu(e.clientX, e.clientY, role, content);
  });

  /* 모바일 롱프레스 (600ms) */
  let pressTimer = null;
  liveMsgs.addEventListener('touchstart', e => {
    const row = e.target.closest('.live-msg-row');
    if (!row) return;
    pressTimer = setTimeout(() => {
      const touch = e.touches[0];
      const role    = row.dataset.role;
      const content = decodeURIComponent(row.dataset.content || '');
      showAdminCtxMenu(touch.clientX, touch.clientY, role, content);
    }, 600);
  }, { passive: true });
  liveMsgs.addEventListener('touchend',   () => clearTimeout(pressTimer));
  liveMsgs.addEventListener('touchmove',  () => clearTimeout(pressTimer));
}
