/* ================================================================
   Admin Backup — 데이터 백업 다운로드 (Phase 2)
   - 전체 ZIP / 단일 CSV
   - 대상 테이블: conversations, test_conversations, quotes
   - 마지막 백업 시각 localStorage 기록 + 7일 경고
================================================================ */

(function () {
  'use strict';

  const LS_KEY_LAST = 'lumane:lastBackupAt';
  const TABLE_LABEL = {
    conversations: '상담기록',
    test_conversations: '테스트상담',
    quotes: '견적',
  };

  // ── 유틸 ──────────────────────────────────────────────────
  function toast(msg, type = 'default') {
    if (typeof showToast === 'function') {
      showToast(msg, type);
    } else {
      // eslint-disable-next-line no-alert
      console.log('[backup]', msg);
    }
  }

  function setLastBackupNow() {
    try {
      localStorage.setItem(LS_KEY_LAST, new Date().toISOString());
    } catch (_) { /* localStorage 차단 환경 무시 */ }
  }

  function getLastBackup() {
    try {
      return localStorage.getItem(LS_KEY_LAST);
    } catch (_) {
      return null;
    }
  }

  function formatKst(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    // 사용자 로컬 시간대 기준 표시
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function relativeFromNow(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return '';
    const min = Math.floor(diff / 60000);
    if (min < 1) return '방금 전';
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const day = Math.floor(hr / 24);
    return `${day}일 전`;
  }

  function daysSince(iso) {
    if (!iso) return Infinity;
    const diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return Infinity;
    return Math.floor(diff / 86400000);
  }

  // ── 화면 렌더링 ───────────────────────────────────────────
  function renderLastBackup() {
    const lastEl = document.getElementById('backupLastTime');
    const infoEl = document.getElementById('backupLastInfo');
    const warnEl = document.getElementById('backupWarn');
    if (!lastEl || !infoEl || !warnEl) return;

    const iso = getLastBackup();
    if (!iso) {
      lastEl.textContent = '-';
      // L1 fix: innerHTML 대신 textContent (XSS safe + 다른 admin 코드 패턴과 일관성)
      infoEl.textContent = '아직 백업한 적이 없습니다.';
      warnEl.style.display = 'none';
      return;
    }

    const formatted = formatKst(iso) || '-';
    const rel = relativeFromNow(iso);
    // L1 fix: DOM API로 안전하게 구성
    infoEl.textContent = '';
    infoEl.appendChild(document.createTextNode('마지막 백업: '));
    const strong = document.createElement('strong');
    strong.textContent = formatted;
    infoEl.appendChild(strong);
    infoEl.appendChild(document.createTextNode(' '));
    const span = document.createElement('span');
    span.style.color = '#6b7280';
    span.textContent = '(' + rel + ')';
    infoEl.appendChild(span);

    const days = daysSince(iso);
    if (days >= 7) {
      warnEl.style.display = 'block';
      warnEl.textContent = `⚠️ 마지막 백업이 ${days}일 전입니다. 백업을 권장합니다.`;
    } else {
      warnEl.style.display = 'none';
    }
  }

  function renderBackupTab() {
    // 섹션 active 토글은 switchTab가 표준 패턴(.active class)으로 처리.
    // 인라인 style 조작 없음 — 다른 탭 전환 시 정상 숨김 보장.
    renderLastBackup();
  }

  // ── 다운로드 트리거 ───────────────────────────────────────
  async function triggerDownload(url, fallbackName) {
    toast('데이터 수집 중... (보통 10~30초)', 'info');
    let res;
    try {
      res = await adminFetch(url, { headers: adminHeaders() });
    } catch (err) {
      toast(`❌ 백업 실패: ${err.message || '네트워크 오류'}. 잠시 후 다시 시도해 주세요.`, 'error');
      return;
    }

    if (res.status === 429) {
      toast('1분에 한 번만 다운로드 가능합니다. 잠시 후 다시 시도해 주세요.', 'error');
      return;
    }

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (_) { /* not json */ }
      toast(`❌ 백업 실패: ${msg}. 잠시 후 다시 시도해 주세요.`, 'error');
      return;
    }

    // 파일명: Content-Disposition 우선, 없으면 fallback
    let filename = fallbackName;
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (m && m[1]) {
      try {
        filename = decodeURIComponent(m[1]);
      } catch (_) {
        filename = m[1];
      }
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 100);

    setLastBackupNow();
    renderLastBackup();
    toast('✅ 백업 다운로드 완료', 'success');
  }

  async function downloadAll() {
    // M4 fix: fallback 파일명은 ASCII (Safari 호환). Content-Disposition은 서버가 한글로 정확히 보냄.
    await triggerDownload(`${SERVER}/api/admin/export`, 'lumane-backup.zip');
  }

  async function downloadOne(table) {
    if (!TABLE_LABEL[table]) {
      toast('❌ 지원하지 않는 테이블입니다.', 'error');
      return;
    }
    // M4 fix: fallback 파일명은 ASCII table key (Safari 호환). 서버 응답 Content-Disposition에 한글명 들어있음.
    await triggerDownload(`${SERVER}/api/admin/export/${encodeURIComponent(table)}`, `lumane-${table}.csv`);
  }

  // ── 외부 노출 ─────────────────────────────────────────────
  window.lumaneBackup = {
    downloadAll,
    downloadOne,
    renderLastBackup,
    renderBackupTab,
  };
})();
