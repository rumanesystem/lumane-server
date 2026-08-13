/* ============================================================
   admin-trash.js — 휴지통 탭 (Phase 2)
   - GET    /api/admin/conversations/trash      목록
   - PATCH  /api/admin/conversations/:id/restore 복원
   - DELETE /api/admin/conversations/:id/purge   영구삭제
   의존: admin-config.js (SERVER, adminHeaders, showToast)
   ============================================================ */

(function () {
  'use strict';

  // ── 상대 시각 (의존성 0) ──────────────────────────────────
  function timeSince(date) {
    if (!date) return '-';
    const then = (date instanceof Date) ? date : new Date(date);
    if (isNaN(then.getTime())) return '-';
    const diffMs = Date.now() - then.getTime();
    if (diffMs < 0) return '방금';
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60)        return `${sec}초 전`;
    const min = Math.floor(sec / 60);
    if (min < 60)        return `${min}분 전`;
    const hr  = Math.floor(min / 60);
    if (hr  < 24)        return `${hr}시간 전`;
    const day = Math.floor(hr / 24);
    if (day < 30)        return `${day}일 전`;
    const mon = Math.floor(day / 30);
    if (mon < 12)        return `${mon}개월 전`;
    const yr  = Math.floor(mon / 12);
    return `${yr}년 전`;
  }

  // ── 미리보기 텍스트 추출 ─────────────────────────────────
  function previewOf(c) {
    const raw = c.summary || c.customer_name || c.phone || c.region || c.size_raw || c.memo || '';
    const s = String(raw).replace(/\s+/g, ' ').trim();
    if (!s) return '(내용 없음)';
    return s.length > 50 ? s.slice(0, 50) + '…' : s;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── 탭 카운트 배지 ────────────────────────────────────────
  function updateTrashBadge(count) {
    const el = document.getElementById('trashTabBadge');
    if (!el) return;
    if (!count || count <= 0) {
      el.style.display = 'none';
      el.textContent = '';
    } else {
      el.style.display = 'inline-block';
      el.textContent = `[${count}]`;
    }
  }

  // ── 목록 렌더 ─────────────────────────────────────────────
  function renderTrashList(items) {
    const wrap = document.getElementById('trashList');
    if (!wrap) return;

    if (!items || items.length === 0) {
      wrap.style.padding = '40px';
      wrap.style.textAlign = 'center';
      wrap.style.color = '#9ca3af';
      wrap.style.fontSize = '14px';
      wrap.innerHTML = '휴지통이 비어 있습니다.';
      return;
    }

    wrap.style.padding = '0';
    wrap.style.textAlign = 'left';
    wrap.style.color = '#111827';
    wrap.style.fontSize = '13px';

    const rows = items.map(c => {
      const id        = c.id;
      const sess      = c.session_id || '-';
      const when      = timeSince(c.deleted_at);
      const whenFull  = c.deleted_at ? new Date(c.deleted_at).toLocaleString('ko-KR') : '';
      const preview   = previewOf(c);
      const isTest    = c.is_test ? '<span style="display:inline-block;font-size:10px;font-weight:700;color:#fff;background:#9ca3af;border-radius:6px;padding:1px 6px;margin-left:4px;vertical-align:middle;">TEST</span>' : '';

      return `
        <tr style="border-top:1px solid #f3f4f6;">
          <td style="padding:10px 12px;color:#6b7280;font-size:12px;white-space:nowrap;">#${escapeHtml(id)}${isTest}</td>
          <td style="padding:10px 12px;color:#374151;font-size:12px;font-family:monospace;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(sess)}">${escapeHtml(sess)}</td>
          <td style="padding:10px 12px;color:#6b7280;font-size:12px;white-space:nowrap;" title="${escapeHtml(whenFull)}">${escapeHtml(when)}</td>
          <td style="padding:10px 12px;color:#111827;">${escapeHtml(preview)}</td>
          <td style="padding:10px 12px;white-space:nowrap;text-align:right;">
            <button onclick="restoreConversation('${escapeHtml(id)}')"
              style="padding:5px 10px;border:1px solid #3b82f6;background:#3b82f6;color:#fff;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;margin-right:6px;">
              ↩ 복원
            </button>
            <button onclick="purgeConversation('${escapeHtml(id)}')"
              style="padding:5px 10px;border:1px solid #ef4444;background:#ef4444;color:#fff;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">
              🔥 영구삭제
            </button>
          </td>
        </tr>
      `;
    }).join('');

    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.02em;">ID</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.02em;">세션</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.02em;">삭제 시각</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.02em;">미리보기</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.02em;">작업</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ── 목록 로드 ─────────────────────────────────────────────
  async function loadTrash() {
    const wrap = document.getElementById('trashList');
    if (wrap) {
      wrap.style.padding = '24px';
      wrap.style.textAlign = 'center';
      wrap.style.color = '#9ca3af';
      wrap.innerHTML = '로딩 중…';
    }
    try {
      const res = await adminFetch(`${SERVER}/api/admin/conversations/trash`, {
        headers: adminHeaders(),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const items = Array.isArray(data.conversations) ? data.conversations : [];
      renderTrashList(items);
      updateTrashBadge(items.length);
    } catch (err) {
      if (wrap) {
        wrap.style.padding = '24px';
        wrap.style.textAlign = 'center';
        wrap.style.color = '#dc2626';
        wrap.innerHTML = `불러오기 실패: ${escapeHtml(err.message)}`;
      }
      updateTrashBadge(0); // 실패 시 stale 배지 방지
      if (typeof showToast === 'function') showToast(`휴지통 로드 실패: ${err.message}`, 'error');
    }
  }

  // ── 복원 (confirm 없음) ──────────────────────────────────
  async function restoreConversation(id) {
    if (!id) return;
    try {
      const res = await adminFetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(id)}/restore`, {
        method: 'PATCH',
        headers: adminHeaders(),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      if (typeof showToast === 'function') {
        showToast('복원되었습니다. "💬 대화" 탭에서 확인하세요.', 'success');
      } else {
        alert('복원되었습니다. "💬 대화" 탭에서 확인하세요.');
      }
      // 목록 재로드
      loadTrash();
    } catch (err) {
      if (typeof showToast === 'function') showToast(`복원 실패: ${err.message}`, 'error');
      else alert(`복원 실패: ${err.message}`);
    }
  }

  // ── 영구삭제 (confirm 1회) ───────────────────────────────
  async function purgeConversation(id) {
    if (!id) return;
    if (!confirm('이 상담을 영구 삭제합니다.\n복구할 수 없습니다. 계속할까요?')) return;
    try {
      const res = await adminFetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(id)}/purge`, {
        method: 'DELETE',
        headers: adminHeaders(),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      if (typeof showToast === 'function') showToast('영구 삭제되었습니다.', 'success');
      else alert('영구 삭제되었습니다.');
      loadTrash();
    } catch (err) {
      if (typeof showToast === 'function') showToast(`영구삭제 실패: ${err.message}`, 'error');
      else alert(`영구삭제 실패: ${err.message}`);
    }
  }

  // ── 전역 노출 ─────────────────────────────────────────────
  window.loadTrash            = loadTrash;
  window.renderTrashList      = renderTrashList;
  window.restoreConversation  = restoreConversation;
  window.purgeConversation    = purgeConversation;
  window.timeSince            = window.timeSince || timeSince;
  window.updateTrashBadge     = updateTrashBadge;
})();
