/* ================================================================
   admin-memos.js — 상담 어드민 메모 (누적, 시간순)

   - historyDetailOverlay 안 메모 패널 연동
   - openHistoryDetail 호출 시 자동으로 hdLoadMemos 실행 (admin.js 통합)
   - window.* 노출: hdLoadMemos / hdAddMemo / hdDeleteMemo / toggleHdMemoPanel

   의존: SERVER, adminHeaders, escAdmin (admin-config.js)
================================================================ */

let _hdMemoCurrentConvId = null;

function _memoTimeStr(iso) {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function _renderHdMemoList(memos) {
  const listEl  = document.getElementById('hdMemoList');
  const countEl = document.getElementById('hdMemoCount');
  if (!listEl) return;
  if (countEl) countEl.textContent = memos.length > 0 ? `(${memos.length})` : '';
  if (memos.length === 0) {
    listEl.innerHTML = '<div style="font-size:11.5px;color:#a16207;padding:6px 0;">메모가 아직 없습니다</div>';
    return;
  }
  listEl.innerHTML = memos.map(m => `
    <div style="background:#fff;border:1px solid #fde047;border-radius:8px;padding:8px 10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="font-size:11px;color:#a16207;font-weight:600;">🕐 ${_memoTimeStr(m.created_at)}</div>
        <button type="button" title="삭제"
          onclick="window.hdDeleteMemo&&window.hdDeleteMemo(${Number(m.id)})"
          style="flex-shrink:0;background:transparent;border:none;color:#a16207;font-size:13px;cursor:pointer;padding:0 4px;line-height:1;"
          onmouseover="this.style.color='#dc2626'"
          onmouseout="this.style.color='#a16207'">🗑</button>
      </div>
      <div style="font-size:12.5px;color:#374151;margin-top:4px;white-space:pre-wrap;line-height:1.5;">${escAdmin(m.body)}</div>
    </div>`).join('');
}

window.hdLoadMemos = async function(convId) {
  _hdMemoCurrentConvId = convId;
  if (!convId) {
    _renderHdMemoList([]);
    return;
  }
  try {
    const res = await fetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(convId)}/memos`, {
      headers: adminHeaders(),
    });
    if (!res.ok) throw new Error('메모 불러오기 실패');
    const { memos } = await res.json();
    _renderHdMemoList(memos || []);
  } catch (err) {
    console.warn('[admin-memos] load 실패:', err.message);
    _renderHdMemoList([]);
  }
};

window.hdAddMemo = async function() {
  const input = document.getElementById('hdMemoInput');
  if (!input || !_hdMemoCurrentConvId) return;
  const body = (input.value || '').trim();
  if (!body) return;
  // 경쟁 조건 가드 — 클로저로 캡처해서 fetch 도중 모달이 다른 대화로 갈아타도 원래 대화에만 박힘
  const capturedId = _hdMemoCurrentConvId;
  try {
    const res = await fetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(capturedId)}/memos`, {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || '메모 추가 실패');
    }
    if (_hdMemoCurrentConvId === capturedId) {
      input.value = '';
      await window.hdLoadMemos(capturedId);
    }
  } catch (err) {
    console.warn('[admin-memos] add 실패:', err.message);
    if (typeof showToast === 'function') showToast(`메모 추가 실패: ${err.message}`, 'error');
  }
};

window.hdDeleteMemo = async function(memoId) {
  const idNum = parseInt(memoId, 10);
  if (!Number.isFinite(idNum) || idNum <= 0) return;
  if (!confirm('이 메모를 삭제할까요?')) return;
  const capturedId = _hdMemoCurrentConvId;
  try {
    const res = await fetch(`${SERVER}/api/admin/memos/${idNum}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    if (!res.ok) throw new Error('삭제 실패');
    if (_hdMemoCurrentConvId && _hdMemoCurrentConvId === capturedId) {
      await window.hdLoadMemos(capturedId);
    }
  } catch (err) {
    console.warn('[admin-memos] delete 실패:', err.message);
    if (typeof showToast === 'function') showToast(`삭제 실패: ${err.message}`, 'error');
  }
};

window.toggleHdMemoPanel = function() {
  const body = document.getElementById('hdMemoBody');
  const chev = document.getElementById('hdMemoChevron');
  if (!body) return;
  const opening = body.style.display === 'none' || body.style.display === '';
  body.style.display = opening ? 'block' : 'none';
  if (chev) chev.style.transform = opening ? 'rotate(180deg)' : 'rotate(0deg)';
};

/* ====================================================================
   라이브 패널용 메모 (lv 접두) — historyDetailOverlay와 별개로 동작
   같은 백엔드 사용, UI ID만 다름
==================================================================== */
let _lvMemoCurrentConvId = null;

function _renderLvMemoList(memos) {
  const listEl  = document.getElementById('lvMemoList');
  const countEl = document.getElementById('lvMemoCount');
  if (!listEl) return;
  if (countEl) countEl.textContent = memos.length > 0 ? `(${memos.length})` : '';
  if (memos.length === 0) {
    listEl.innerHTML = '<div style="font-size:11.5px;color:#a16207;padding:6px 0;">메모가 아직 없습니다</div>';
    return;
  }
  listEl.innerHTML = memos.map(m => `
    <div style="background:#fff;border:1px solid #fde047;border-radius:8px;padding:8px 10px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="font-size:11px;color:#a16207;font-weight:600;">🕐 ${_memoTimeStr(m.created_at)}</div>
        <button type="button" title="삭제"
          onclick="window.lvDeleteMemo&&window.lvDeleteMemo(${Number(m.id)})"
          style="flex-shrink:0;background:transparent;border:none;color:#a16207;font-size:13px;cursor:pointer;padding:0 4px;line-height:1;"
          onmouseover="this.style.color='#dc2626'"
          onmouseout="this.style.color='#a16207'">🗑</button>
      </div>
      <div style="font-size:12.5px;color:#374151;margin-top:4px;white-space:pre-wrap;line-height:1.5;">${escAdmin(m.body)}</div>
    </div>`).join('');
}

window.lvLoadMemos = async function(convId) {
  _lvMemoCurrentConvId = convId || null;
  const panel = document.getElementById('lvMemoPanel');
  if (!convId) {
    if (panel) panel.style.display = 'none';
    _renderLvMemoList([]);
    return;
  }
  if (panel) panel.style.display = 'block';
  try {
    const res = await fetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(convId)}/memos`, {
      headers: adminHeaders(),
    });
    if (!res.ok) throw new Error('메모 불러오기 실패');
    const { memos } = await res.json();
    _renderLvMemoList(memos || []);
  } catch (err) {
    console.warn('[admin-memos lv] load 실패:', err.message);
    _renderLvMemoList([]);
  }
};

window.lvAddMemo = async function() {
  const input = document.getElementById('lvMemoInput');
  if (!input || !_lvMemoCurrentConvId) return;
  const body = (input.value || '').trim();
  if (!body) return;
  const capturedId = _lvMemoCurrentConvId;
  try {
    const res = await fetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(capturedId)}/memos`, {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || '메모 추가 실패');
    }
    if (_lvMemoCurrentConvId === capturedId) {
      input.value = '';
      await window.lvLoadMemos(capturedId);
    }
  } catch (err) {
    console.warn('[admin-memos lv] add 실패:', err.message);
    if (typeof showToast === 'function') showToast(`메모 추가 실패: ${err.message}`, 'error');
  }
};

window.lvDeleteMemo = async function(memoId) {
  const idNum = parseInt(memoId, 10);
  if (!Number.isFinite(idNum) || idNum <= 0) return;
  if (!confirm('이 메모를 삭제할까요?')) return;
  const capturedId = _lvMemoCurrentConvId;
  try {
    const res = await fetch(`${SERVER}/api/admin/memos/${idNum}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    if (!res.ok) throw new Error('삭제 실패');
    if (_lvMemoCurrentConvId && _lvMemoCurrentConvId === capturedId) {
      await window.lvLoadMemos(capturedId);
    }
  } catch (err) {
    console.warn('[admin-memos lv] delete 실패:', err.message);
    if (typeof showToast === 'function') showToast(`삭제 실패: ${err.message}`, 'error');
  }
};

window.toggleLvMemoPanel = function() {
  const body = document.getElementById('lvMemoBody');
  const chev = document.getElementById('lvMemoChevron');
  if (!body) return;
  const opening = body.style.display === 'none' || body.style.display === '';
  body.style.display = opening ? 'block' : 'none';
  if (chev) chev.style.transform = opening ? 'rotate(180deg)' : 'rotate(0deg)';
};

/* 라이브 패널: 라이브 세션 선택 시 메모 패널 숨김 (저장 안 됐으니 conv_id 없음) */
window.lvHideMemoPanel = function() {
  _lvMemoCurrentConvId = null;
  const panel = document.getElementById('lvMemoPanel');
  if (panel) panel.style.display = 'none';
};
