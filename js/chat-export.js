/* ================================================================
   chat-export.js — 대화 내용 저장 (A + D-약 통합)

   - 헤더 💾 버튼 클릭 → .txt 다운로드
   - .txt 헤더 안에 "다시 보기 링크" 자동 포함 (같은 브라우저 visitor_key 자동 매칭)

   window.* 노출: downloadChatText
   의존: 없음 (DOM + location만 사용)
================================================================ */

function _now() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return {
    file: `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`,
    human: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/* ================ A: 텍스트 다운로드 ================ */
function _extractMessages() {
  const root = document.getElementById('messages');
  if (!root) return [];

  // ui.js addMsg가 생성하는 실제 구조: .msg-group.bot / .msg-group.user
  // 본문은 .bubble (한 메시지에 .bubble 여러 개 존재 가능 — 문단 분리)
  const groups = root.querySelectorAll('.msg-group');
  const rows = [];

  groups.forEach(g => {
    const role = g.classList.contains('user') ? '고객'
              : g.classList.contains('bot')  ? '루마네'
              : '';
    const bubbles = g.querySelectorAll('.bubble');
    const parts = [];
    bubbles.forEach(b => {
      const t = (b.textContent || '').trim();
      if (t) parts.push(t);
    });
    const text = parts.join('\n');
    if (text) rows.push({ role, text });
  });

  return rows;
}

window.downloadChatText = function() {
  const rows = _extractMessages();
  if (rows.length === 0) {
    alert('저장할 대화 내용이 없습니다.');
    return;
  }

  const t = _now();
  const restoreUrl = `${location.origin}${location.pathname}`;
  const header = [
    '═══════════════════════════════════════',
    '   케이트블랑 드레스룸 — 루마네 상담 기록',
    `   저장 시각: ${t.human}`,
    '',
    '   📌 이 상담 다시 보기 (같은 폰·브라우저):',
    `   ${restoreUrl}`,
    '   ※ 다른 기기에서 열면 새 대화로 시작됩니다.',
    '═══════════════════════════════════════',
    '',
  ].join('\n');

  const body = rows.map(r => {
    const tag = r.role ? `[${r.role}]` : '';
    return `${tag}\n${r.text}\n`;
  }).join('\n');

  const footer = [
    '',
    '═══════════════════════════════════════',
    '   ※ 본 견적은 상담 시점 기준이며,',
    '      실측 후 변동될 수 있습니다.',
    '   문의: 010-3784-5215',
    '═══════════════════════════════════════',
  ].join('\n');

  const blob = new Blob([header + body + footer], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `루마네_상담_${t.file}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
