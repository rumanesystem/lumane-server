/* ================================================================
   UI 조작 — 메시지 렌더링, 타이핑 인디케이터, 퀵버튼, 배너, 로딩
================================================================ */
import { esc, nowStr, tsToStr } from './utils.js';
import { SERVER } from './config.js';
import { buildQuoteDom } from './reply.js';

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

/* ── 메시지 ID 카운터 ── */
let _midSeq = 0;
export function allocMid() { return ++_midSeq; }

/* ── 액션 콜백 (chat.js에서 주입) ── */
let _onReply  = null;
let _onEdit   = null;
let _onDelete = null;
export function setMsgActionHandlers({ onReply, onEdit, onDelete }) {
  _onReply  = onReply;
  _onEdit   = onEdit;
  _onDelete = onDelete;
}

/* ── 이모티콘 목록 ── */
const EMOJIS = ['😊','😄','🥰','😅','🤔','😂','🙏','👍','💜','✨','❤️','🎉','👋','😍','😢','🙌','💪','🤩'];

/* ── DOM 참조 (DOMContentLoaded 이후에 초기화) ── */
let $msgs, $inp, $sendBtn, $quickArea, $banner, $statusTxt;
let isLoading = false;

export function initUI() {
  $msgs      = document.getElementById('messages');
  $inp       = document.getElementById('inp');
  $sendBtn   = document.getElementById('sendBtn');
  $quickArea = document.getElementById('quickArea');
  $banner    = document.getElementById('banner');
  $statusTxt = document.getElementById('statusText');
  initEmojiPicker();
  initAttachBtn();
}

/* ── 로딩 상태 ── */
export function getIsLoading() { return isLoading; }

export function setLoading(val) {
  isLoading = val;
  $inp.disabled = val;
  $sendBtn.dataset.loading = val ? '1' : '';
  refreshSendBtn();
  if (val) {
    showTyping();
  } else {
    hideTyping();
    // PC에서만 자동 포커스 (모바일은 키보드 강제팝업 방지)
    if (window.matchMedia('(hover: hover)').matches) $inp.focus();
  }
}

/* ── 전송 버튼 활성화 상태 갱신 (파일 첨부 or 텍스트 기준) ── */
function refreshSendBtn() {
  $sendBtn.disabled = isLoading || (!$inp.value.trim() && !pendingFile);
}

/* ── 입력창 자동 높이 조정 ── */
export function autoResize() {
  $inp.style.height = 'auto';
  $inp.style.height = Math.min($inp.scrollHeight, 120) + 'px';
}

export function getInputValue() { return $inp.value.trim(); }
export function clearInput() { $inp.value = ''; autoResize(); }

/* ── 이벤트 리스너 등록 ── */
export function initInputListeners(onSend) {
  $inp.addEventListener('input', () => {
    autoResize();
    refreshSendBtn();
  });
  $inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        /* Shift+Enter → 줄바꿈 */
        e.preventDefault();
        const pos = $inp.selectionStart;
        $inp.value = $inp.value.slice(0, pos) + '\n' + $inp.value.slice($inp.selectionEnd);
        $inp.selectionStart = $inp.selectionEnd = pos + 1;
        autoResize();
        refreshSendBtn();
      } else {
        e.preventDefault();
        onSend();
      }
    }
  });
  $sendBtn.addEventListener('click', () => onSend());
}

/* ── 스크롤 상태 ── */
let stickyBottom = true;
let _toastEl     = null;

function isAtBottom() {
  return $msgs.scrollHeight - $msgs.scrollTop - $msgs.clientHeight < 60;
}

/* 새 메시지 미리보기 토스트 */
function showNewMsgToast(sender, text) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.className = 'new-msg-toast';
    _toastEl.addEventListener('click', () => scrollBottom());

    const sEl = document.createElement('span');
    sEl.className = 'nmt-sender';
    const tEl = document.createElement('span');
    tEl.className = 'nmt-text';
    const aEl = document.createElement('span');
    aEl.className = 'nmt-arrow';
    aEl.textContent = '↓';
    _toastEl.append(sEl, tEl, aEl);

    $msgs.parentElement.appendChild(_toastEl);
  }
  const preview = (text || '').replace(/\n/g, ' ').trim().slice(0, 38);
  _toastEl.querySelector('.nmt-sender').textContent = sender;
  _toastEl.querySelector('.nmt-text').textContent   = preview + (preview.length >= 38 ? '…' : '');
  _toastEl.classList.add('show');
}

function hideNewMsgToast() {
  _toastEl?.classList.remove('show');
}

/* 내부용: 하단 고정이면 스크롤, 아니면 미리보기 */
function scrollOrPreview(sender, text) {
  if (stickyBottom) {
    requestAnimationFrame(() => { $msgs.scrollTop = $msgs.scrollHeight; });
  } else {
    hideNewMsgToast();
    requestAnimationFrame(() => showNewMsgToast(sender, text));
  }
}

/* 강제 스크롤 (페이지 로드 / 미리보기 클릭 / 사용자 메시지 전송) */
export function scrollBottom() {
  stickyBottom = true;
  hideNewMsgToast();
  requestAnimationFrame(() => { $msgs.scrollTop = $msgs.scrollHeight; });
}

/* 스크롤 이벤트 초기화 */
export function initScrollBehavior() {
  if (!$msgs) return;
  $msgs.addEventListener('scroll', () => {
    if (isAtBottom()) {
      stickyBottom = true;
      hideNewMsgToast();
    } else {
      stickyBottom = false;
    }
  }, { passive: true });
}

/* ================================================================
   복사 기능 — 길게 누르기(모바일) / 우클릭(PC)
================================================================ */
function showCopyToast(msg = '복사되었습니다') {
  const existing = document.querySelector('.copy-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 1600);
}

function copyText(text) {
  const plain = text.replace(/<br\s*\/?>/gi, '\n').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(plain).then(() => showCopyToast()).catch(() => fallbackCopy(plain));
  } else {
    fallbackCopy(plain);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showCopyToast();
}

function addContextMenu(el, rawText) {
  let pressTimer;

  /* 모바일: 600ms 길게 누르기 → 컨텍스트 메뉴 */
  el.addEventListener('touchstart', e => {
    pressTimer = setTimeout(() => {
      const touch = e.touches[0];
      showMsgContextMenu(el, touch.clientX, touch.clientY, rawText);
    }, 600);
  }, { passive: true });
  el.addEventListener('touchend',  () => clearTimeout(pressTimer), { passive: true });
  el.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true });

  /* PC: 우클릭 → 컨텍스트 메뉴 */
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation(); // document 버블링 차단 → 연속 우클릭 정상 동작
    showMsgContextMenu(el, e.clientX, e.clientY, rawText);
  });
}

/* ── 글로벌 컨텍스트 메뉴 ── */
let _ctxMenu = null;

function showMsgContextMenu(groupEl, x, y, text) {
  closeMsgContextMenu();

  const mid  = groupEl.dataset.mid;
  const role = groupEl.classList.contains('user') ? 'user' : 'bot';

  const items = [
    { label: '↩ 답장',  action: 'reply' },
    { label: '📋 복사',  action: 'copy'  },
  ];
  if (role === 'user') {
    items.push({ label: '✏️ 수정', action: 'edit'   });
    items.push({ label: '🗑 삭제', action: 'delete', danger: true });
  }

  const menu = document.createElement('div');
  menu.id = 'msgCtxMenu';
  menu.className = 'ctx-menu';

  items.forEach(({ label, action, danger }) => {
    const btn = document.createElement('button');
    btn.className = 'ctx-item' + (danger ? ' ctx-danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      closeMsgContextMenu();
      if (action === 'copy')   copyText(text);
      if (action === 'reply'  && _onReply)  _onReply(mid, role, text);
      if (action === 'edit'   && _onEdit)   _onEdit(mid, text);
      if (action === 'delete' && _onDelete) _onDelete(mid);
    });
    menu.appendChild(btn);
  });

  /* 화면 밖으로 나가지 않도록 위치 보정 */
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:9990;`;
  document.body.appendChild(menu);
  _ctxMenu = menu;

  /* 메뉴가 오른쪽/아래 경계를 넘어가면 반대쪽으로 */
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right  > window.innerWidth)  menu.style.left = (x - r.width)  + 'px';
    if (r.bottom > window.innerHeight) menu.style.top  = (y - r.height) + 'px';
  });

  /* 메뉴 바깥 클릭 시 닫기 */
  setTimeout(() => {
    document.addEventListener('click', closeMsgContextMenu, { once: true });
    document.addEventListener('contextmenu', closeMsgContextMenu, { once: true });
  }, 0);
}

function closeMsgContextMenu() {
  _ctxMenu?.remove();
  _ctxMenu = null;
}

/* ── 메시지 액션바 생성 ── */
function makeActionBar(mid, role, text) {
  const bar = document.createElement('div');
  bar.className = 'msg-action-bar' + (role === 'user' ? ' mab-user' : ' mab-bot');

  const btns = [
    { label: '↩', title: '답장', action: 'reply' },
    { label: '📋', title: '복사', action: 'copy' },
  ];
  if (role === 'user') {
    btns.push({ label: '✏️', title: '수정', action: 'edit' });
    btns.push({ label: '🗑', title: '삭제', action: 'delete' });
  }

  btns.forEach(({ label, title, action }) => {
    const btn = document.createElement('button');
    btn.className = 'mab-btn';
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      bar.classList.remove('visible');
      if (action === 'copy')   copyText(text);
      if (action === 'reply'  && _onReply)  _onReply(mid, role, text);
      if (action === 'edit'   && _onEdit)   _onEdit(mid, text);
      if (action === 'delete' && _onDelete) _onDelete(mid);
    });
    bar.appendChild(btn);
  });

  return bar;
}


/* ================================================================
   메시지 내용 렌더링 — 이미지/파일 패턴 감지
================================================================ */
function renderBubbleContent(text) {
  /* [이미지]\nURL */
  const imgMatch = text.match(/^\[이미지\]\n(https?:\/\/\S+)$/);
  if (imgMatch) {
    const url = imgMatch[1];
    const img = document.createElement('img');
    img.src = url;
    img.className = 'img-example';
    img.alt = '첨부 이미지';
    img.style.maxWidth = '220px';
    img.onclick = () => window.open(url, '_blank', 'noopener,noreferrer');
    const dlBtn = document.createElement('button');
    dlBtn.className = 'img-download-btn';
    dlBtn.textContent = '⬇ 다운로드';
    dlBtn.onclick = () => downloadImage(url, '이미지');
    const wrap = document.createElement('div');
    wrap.appendChild(img);
    wrap.appendChild(dlBtn);
    return wrap;
  }
  /* [파일: name]\nURL */
  const fileMatch = text.match(/^\[파일: ([^\]]+)\]\n(https?:\/\/\S+)$/);
  if (fileMatch) {
    const [, name, url] = fileMatch;
    const ext = name.split('.').pop().toLowerCase();

    /* 동영상 */
    if (/^(mp4|webm|ogg|mov)$/.test(ext)) {
      const video = document.createElement('video');
      video.src = url; video.controls = true; video.preload = 'metadata';
      video.style.cssText = 'max-width:260px;border-radius:10px;display:block;';
      return video;
    }
    /* 음성 */
    if (/^(mp3|wav|ogg|m4a|aac)$/.test(ext)) {
      const audio = document.createElement('audio');
      audio.src = url; audio.controls = true; audio.preload = 'metadata';
      audio.style.cssText = 'max-width:260px;display:block;';
      return audio;
    }

    const wrap = document.createElement('div');
    wrap.innerHTML = `📎 <a href="${url}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">${esc(name)}</a>`;
    return wrap;
  }
  return null; // 일반 텍스트
}

/* ================================================================
   견적서 → PNG 이미지 렌더링 (html2canvas)
================================================================ */
async function renderQuoteImage(text) {
  const card = document.createElement('div');
  card.style.cssText = [
    'position:fixed', 'left:-9999px', 'top:0',
    'width:340px', 'background:#fff',
    'font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif',
    'font-size:12px', 'line-height:1.6', 'color:#222',
    'border-radius:12px', 'overflow:hidden',
  ].join(';');

  const clean = text
    .replace(/&nbsp;/g, ' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();

  let html = '';
  for (const line of clean.split('\n')) {
    const t = line.trim();
    if (!t) { html += '<div style="height:4px"></div>'; continue; }
    if (/케이트블랑.*견적서/.test(t)) {
      html += `<div style="background:#c0392b;color:#fff;text-align:center;padding:11px 12px;font-size:15px;font-weight:900;">${esc(t)}</div>`;
    } else if (t === '---') {
      html += '<hr style="margin:2px 0;border:none;border-top:1px solid #e5e5e5;">';
    } else if (/주문내역/.test(t)) {
      html += `<div style="background:#c0392b;color:#fff;padding:5px 12px;font-weight:bold;font-size:12px;">${esc(t)}</div>`;
    } else if (/평면도|현장 확인 후 작성/.test(t)) {
      // 평면도 없으면 표시 안 함
    } else if (/^\(주\)루마네/.test(t)) {
      // 푸터 줄 제외
    } else {
      html += `<div style="padding:2px 12px;">${esc(t)}</div>`;
    }
  }
  card.innerHTML = html;
  document.body.appendChild(card);

  try {
    const canvas = await window.html2canvas(card, { scale: 2, useCORS: true, backgroundColor: '#fff', logging: false });
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.alt = '케이트블랑 드레스룸 견적서';
    img.style.cssText = 'max-width:280px;border-radius:12px;display:block;cursor:zoom-in;box-shadow:0 2px 10px rgba(0,0,0,0.15);';
    img.title = '클릭하면 크게 볼 수 있어요';
    img.onclick = () => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
      const big = document.createElement('img');
      big.src = img.src;
      big.alt = '케이트블랑 드레스룸 견적서 (확대)';
      big.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.4);';
      overlay.appendChild(big);
      overlay.onclick = () => overlay.remove();
      document.body.appendChild(overlay);
    };
    const dlBtn = document.createElement('button');
    dlBtn.className = 'img-download-btn';
    dlBtn.textContent = '⬇ 견적서 저장';
    dlBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = img.src;
      a.download = '케이트블랑_견적서.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
    const wrap = document.createElement('div');
    wrap.appendChild(img);
    wrap.appendChild(dlBtn);
    return wrap;
  } finally {
    if (card.isConnected) document.body.removeChild(card);
  }
}

/* ================================================================
   메시지 렌더링
================================================================ */
export function addMsg(role, text, { mid = null, replyTo = null, time = null, skipQuoteImage = false } = {}) {
  const clean = text.replace(/```json[\s\S]*?```/g, '').trim();
  const msgMid = mid ?? allocMid();

  if (role === 'bot') {

    /* ①②③ 선택지 줄은 setQuick이 버튼으로 렌더 → 말풍선 텍스트에선 제거(중복 방지).
       clean 원본은 견적감지·복사·미리보기용으로 유지, 표시용 parts만 정제 */
    const _circled = '①②③④⑤⑥⑦⑧⑨⑩';
    const _circCount = clean.split('\n').filter(l => _circled.includes(l.trim()[0])).length;
    const _displayClean = _circCount >= 2
      ? clean.split('\n').filter(l => !_circled.includes(l.trim()[0])).join('\n').trim()
      : clean;
    /* 문단 기준으로 말풍선 분리 */
    const parts = _displayClean.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

    const group = document.createElement('div');
    group.className = 'msg-group bot';
    group.dataset.mid = msgMid;

    /* 아바타 — 킵3 골드 원형 */
    const av = document.createElement('div');
    av.className = 'av';
    av.textContent = '루';
    group.appendChild(av);

    /* 본문 */
    const body = document.createElement('div');
    body.className = 'msg-body';

    /* 발신자 이름 */
    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = '루마네';
    body.appendChild(sender);

    /* 말풍선 행 */
    const bubblesRow = document.createElement('div');
    bubblesRow.className = 'msg-bubbles-row';

    const bubblesCol = document.createElement('div');
    bubblesCol.className = 'msg-bubbles';

    /* 답장 인용 */
    if (replyTo) {
      const q = buildQuoteDom(replyTo, false);
      if (q) bubblesCol.appendChild(q);
    }

    /* 견적서 감지 → PNG 이미지로 렌더링 */
    const _kbQuote = /케이트블랑.*견적서/.test(clean) && /고객명|설치지역|총\s*금액|주문내역|\[고객\s*정보\]|\[설치\s*공간\]|\[금액\]/.test(clean);
    const _bracketQuote = /\[설치\s*공간\]/.test(clean) && /\[금액\]/.test(clean);
    const looksLikeQuote = _kbQuote || _bracketQuote;
    const isQuote = !skipQuoteImage && looksLikeQuote && typeof window.html2canvas === 'function';
    let hasSpecial = false;

    if (isQuote) {
      hasSpecial = true;

      /* 견적서 위(인사)·아래(후속질문) 분리 → 견적 본문만 PNG, 인사·후속은 별도 버블 */
      let introText, quoteText, followText;
      const _kbIdx = clean.search(/케이트블랑/);
      if (_kbIdx !== -1) {
        /* 케이트블랑 견적서 형식 (기존: ---  구분자) */
        introText = _kbIdx > 0 ? clean.slice(0, _kbIdx).trim() : '';
        const quoteAndMore = clean.slice(_kbIdx);
        const lastSepIdx = quoteAndMore.lastIndexOf('\n---');
        quoteText  = lastSepIdx !== -1 ? quoteAndMore.slice(0, lastSepIdx).trim() : quoteAndMore;
        followText = lastSepIdx !== -1
          ? quoteAndMore.slice(lastSepIdx).replace(/^---$/gm, '').replace(/^\(주\)루마네[^\n]*/m, '').trim()
          : '';
      } else {
        /* [설치 공간]…[안내] 브라켓 형식 — [안내] 뒤 첫 '일반 산문 줄'부터 후속으로 분리
           (\n\n 유무 무관: 불릿/섹션헤더/빈줄이 아닌 첫 대화 줄 = 후속질문 시작) */
        const sIdx = clean.search(/\[설치\s*공간\]/);
        introText = sIdx > 0 ? clean.slice(0, sIdx).trim() : '';
        const rest = clean.slice(sIdx < 0 ? 0 : sIdx);
        const lines = rest.split('\n');
        const anaeLine = lines.findIndex(l => /\[안내\]/.test(l));
        let cut = -1;
        if (anaeLine !== -1) {
          for (let i = anaeLine + 1; i < lines.length; i++) {
            const ln = lines[i].trim();
            if (ln === '' || ln[0] === '-' || ln[0] === '[' || ln[0] === '•') continue;
            cut = i; break;   /* 첫 일반 산문 줄 = 후속(할인 질문 등) 시작 */
          }
        }
        if (cut !== -1) {
          quoteText  = lines.slice(0, cut).join('\n').trim();
          followText = lines.slice(cut).join('\n').trim();
        } else {
          quoteText  = rest.trim();
          followText = '';
        }
      }

      /* 견적서 앞 AI 인사 멘트 → 먼저 텍스트 버블로 표시 */
      if (introText) {
        for (const part of introText.split(/\n\n+/).map(p => p.trim()).filter(Boolean)) {
          const b = document.createElement('div');
          b.className = 'bubble bot';
          b.innerHTML = esc(part).replace(/\n/g, '<br>');
          bubblesCol.appendChild(b);
        }
        scrollOrPreview('루마네', introText);
      }

      const placeholder = document.createElement('div');
      placeholder.className = 'bubble bot';
      placeholder.style.cssText = 'color:#888;font-size:13px;';
      placeholder.textContent = '📋 견적서 이미지 생성 중...';
      bubblesCol.appendChild(placeholder);
      renderQuoteImage(quoteText)
        .then(quoteEl => {
          if (!placeholder.isConnected) return;
          placeholder.replaceWith(quoteEl);
          /* 견적 뒤 AI 멘트가 있으면 별도 말풍선으로 */
          if (followText) {
            const b = document.createElement('div');
            b.className = 'bubble bot';
            b.innerHTML = esc(followText).replace(/\n/g, '<br>');
            bubblesCol.appendChild(b);
          }
          scrollOrPreview('루마네', clean);
        })
        .catch(() => {
          if (!placeholder.isConnected) return;
          placeholder.remove();
          /* introText가 이미 DOM에 있으면 quoteText+followText만 fallback */
          const fallbackText = introText
            ? quoteText + (followText ? '\n\n' + followText : '')
            : clean;
          for (const part of fallbackText.split(/\n\n+/).map(p => p.trim()).filter(Boolean)) {
            const b = document.createElement('div');
            b.className = 'bubble bot';
            b.innerHTML = esc(part).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            bubblesCol.appendChild(b);
          }
          scrollOrPreview('루마네', fallbackText);
        });
    } else {
      for (const part of parts) {
        const special = renderBubbleContent(part);
        if (special) {
          hasSpecial = true;
          bubblesCol.appendChild(special);
        } else {
          const b = document.createElement('div');
          b.className = 'bubble bot';
          b.innerHTML = esc(part).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
          bubblesCol.appendChild(b);
        }
      }
    }

    /* 메타 (시간) */
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = time ? tsToStr(time) : nowStr();
    meta.appendChild(timeEl);

    bubblesRow.appendChild(bubblesCol);
    bubblesRow.appendChild(meta);
    body.appendChild(bubblesRow);
    group.appendChild(body);

    $msgs.appendChild(group);
    addContextMenu(group, clean);
    if (!hasSpecial) appendLinkPreviews(bubblesCol, clean);
    if (!isQuote) scrollOrPreview('루마네', clean);
    return;

  } else {
    /* 내 메시지 */
    const group = document.createElement('div');
    group.className = 'msg-group user';
    group.dataset.mid = msgMid;

    const bubblesRow = document.createElement('div');
    bubblesRow.className = 'msg-bubbles-row';

    /* 메타: 읽음 "1" + 시간 (말풍선 왼쪽) */
    const meta = document.createElement('div');
    meta.className = 'msg-meta';

    const timeEl = document.createElement('span');
    timeEl.className = 'msg-time';
    timeEl.textContent = time ? tsToStr(time) : nowStr();
    meta.appendChild(timeEl);

    const bubblesCol = document.createElement('div');
    bubblesCol.className = 'msg-bubbles';

    /* 답장 인용 */
    if (replyTo) {
      const q = buildQuoteDom(replyTo, true);
      if (q) bubblesCol.appendChild(q);
    }

    const special = renderBubbleContent(clean);
    if (special) {
      bubblesCol.appendChild(special);
    } else {
      const b = document.createElement('div');
      b.className = 'bubble user';
      b.innerHTML = esc(clean);
      bubblesCol.appendChild(b);
    }

    bubblesRow.appendChild(meta);
    bubblesRow.appendChild(bubblesCol);
    group.appendChild(bubblesRow);

    $msgs.appendChild(group);
    addContextMenu(group, clean);
    if (!special) appendLinkPreviews(bubblesCol, clean);
  }

  scrollBottom();
}

/* ── 링크 미리보기 (비동기) ── */
async function appendLinkPreviews(container, text) {
  const urls = [...new Set(text.match(URL_REGEX) || [])];
  for (const url of urls.slice(0, 1)) { // 첫 번째 링크만
    try {
      const r = await fetch(`${SERVER}/api/og?url=${encodeURIComponent(url)}`);
      if (!r.ok) continue;
      const d = await r.json();
      if (!d.domain && !d.title && !d.description) continue; // 아무것도 없으면 스킵

      const card = document.createElement('a');
      card.className = 'link-preview';
      card.href = url;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      if (d.image) {
        const img = document.createElement('img');
        img.className = 'lp-img';
        img.src = d.image;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = function() { this.remove(); };
        card.appendChild(img);
      }
      const textDiv = document.createElement('div');
      textDiv.className = 'lp-text';
      textDiv.innerHTML =
        `<div class="lp-domain">${esc(d.domain || new URL(url).hostname)}</div>` +
        (d.title       ? `<div class="lp-title">${esc(d.title)}</div>`       : '') +
        (d.description ? `<div class="lp-desc">${esc(d.description)}</div>`  : '');
      card.appendChild(textDiv);
      container.appendChild(card);
      if (stickyBottom) requestAnimationFrame(() => { $msgs.scrollTop = $msgs.scrollHeight; });
    } catch { /* 무시 */ }
  }
}

/* ── 이미지 다운로드 ── */
async function downloadImage(url, label) {
  try {
    const res  = await fetch(url);
    const blob = await res.blob();
    const a    = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const ext  = blob.type === 'image/png' ? 'png' : 'jpg';
    a.download = label ? `${label.replace(/\s+/g, '_')}.${ext}` : `드레스룸_예시.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/* ── 예시 이미지 메시지 ── */
export function addImageMsg(imgUrl, label) {
  const group = document.createElement('div');
  group.className = 'msg-group bot';

  const av = document.createElement('div');
  av.className = 'av';
  av.textContent = '👩‍💼';
  group.appendChild(av);

  const body = document.createElement('div');
  body.className = 'msg-body';

  const sender = document.createElement('div');
  sender.className = 'msg-sender';
  sender.textContent = '루마네';
  body.appendChild(sender);

  const bubblesRow = document.createElement('div');
  bubblesRow.className = 'msg-bubbles-row';

  const bubblesCol = document.createElement('div');
  bubblesCol.className = 'msg-bubbles';

  const img = document.createElement('img');
  img.src = imgUrl;
  img.className = 'img-example';
  img.alt = label || '드레스룸 예시 이미지';
  img.onclick = () => window.open(imgUrl, '_blank', 'noopener,noreferrer');
  img.onerror = () => { group.remove(); };
  bubblesCol.appendChild(img);

  if (label) {
    const lbl = document.createElement('div');
    lbl.className = 'img-example-label';
    lbl.textContent = label;
    bubblesCol.appendChild(lbl);
  }

  const dlBtn = document.createElement('button');
  dlBtn.className = 'img-download-btn';
  dlBtn.textContent = '⬇ 다운로드';
  dlBtn.onclick = () => downloadImage(imgUrl, label);
  bubblesCol.appendChild(dlBtn);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = nowStr();
  meta.appendChild(timeEl);

  bubblesRow.appendChild(bubblesCol);
  bubblesRow.appendChild(meta);
  body.appendChild(bubblesRow);
  group.appendChild(body);

  $msgs.appendChild(group);
  scrollOrPreview('루마네', label || '이미지 예시');
}

/* ── 타이핑 인디케이터 ── */
export function showTyping() {
  if (document.getElementById('typing')) return;
  const el = document.createElement('div');
  el.className = 'typing';
  el.id = 'typing';
  el.innerHTML =
    `<div class="av">루</div>` +
    `<div class="typing-body">` +
      `<div class="typing-name">루마네</div>` +
      `<div class="typing-bubble">` +
        `<div class="td"></div><div class="td"></div><div class="td"></div>` +
      `</div>` +
    `</div>`;
  $msgs.appendChild(el);
  scrollOrPreview('루마네', '입력 중…');
}

export function hideTyping() {
  document.getElementById('typing')?.remove();
}

/* 상담원 타이핑 표시 (AI 타이핑과 별도 엘리먼트) */
export function showAdminTyping() {
  if (document.getElementById('adminTyping')) return;
  const el = document.createElement('div');
  el.className = 'typing';
  el.id = 'adminTyping';
  el.innerHTML =
    `<div class="av">담</div>` +
    `<div class="typing-body">` +
      `<div class="typing-name">담당자</div>` +
      `<div class="typing-bubble">` +
        `<div class="td"></div><div class="td"></div><div class="td"></div>` +
      `</div>` +
    `</div>`;
  $msgs.appendChild(el);
  scrollOrPreview('담당자', '입력 중…');
}

export function hideAdminTyping() {
  document.getElementById('adminTyping')?.remove();
}

/* ── 퀵 버튼 ── */
export function setQuick(labels, isChoice = false, opts = {}) {
  $quickArea.innerHTML = '';
  if (!labels || labels.length === 0) return;

  /* G6: 직접입력 칩 공통 부착. 기본 ON. 예/아니오 양자택일 질문만 opts.allowManual:false */
  const allowManual = opts.allowManual !== false;

  /* 전부 인라인 카드로 통일 — 말풍선 안에 렌더. 호스트 없으면 quickArea 폴백 */
  const t = _cardTarget({ inline: true });

  /* 인라인이면 힌트 생략(말풍선 자체가 질문), quickArea 폴백 시에만 힌트 */
  if (!t.inline) {
    const hint = document.createElement('div');
    hint.className = 'quick-hint-label';
    hint.textContent = isChoice
      ? '아래 버튼을 눌러 선택해 주세요'
      : '💡 예시 — 직접 입력해도 됩니다';
    t.el.appendChild(hint);
  }

  const wrap = document.createElement('div');
  wrap.className = 'quick-btns quick-btns--stack';

  labels.forEach(label => {
    const b = document.createElement('button');
    b.className = isChoice ? 'qbtn choice' : 'qbtn';
    b.textContent = label;
    b.onclick = () => {
      if (t.inline && t.el.parentNode) t.el.remove();
      $inp.value = label;
      refreshSendBtn();
      $sendBtn.click();
    };
    wrap.appendChild(b);
  });

  if (allowManual) {
    const manual = document.createElement('button');
    manual.className = 'qbtn qbtn--manual';
    manual.textContent = '✏️ 직접 입력';
    manual.onclick = () => {
      if (t.inline && t.el.parentNode) t.el.remove();
      else $quickArea.innerHTML = '';
      $inp.focus();
    };
    wrap.appendChild(manual);
  }

  t.el.appendChild(wrap);
}

/* ── 카드형 퀵 UI — 킵3 디자인 (예산/형태/옵션) ── */
const SHAPE_CARDS = [
  { value: '1자형',  emoji: 'ㅡㅡ',  label: '1자형',  sub: '한쪽 벽면' },
  { value: 'ㄱ자형', emoji: 'ㄱ',   label: 'ㄱ자형', sub: '두 벽면 (코너)' },
  { value: 'ㄷ자형', emoji: 'ㄷ',   label: 'ㄷ자형', sub: '세 벽면 둘러싸기' },
  { value: '11자형', emoji: '‖', label: '11자형', sub: '마주보는 두 벽면' },
];
/* 예산 구간 — 지침/10_예외처리규칙.md 형태별 참고 가격대에 맞춰 설계
   1자형 소형 기본 ~35만 / 1자형 옵션포함 35~70만 / ㄱ자형 60~90만 / ㄷ자형 옵션포함 80~150만 */
const BUDGET_CARDS = [
  { value: '50만원 이하',       emoji: '💡', label: '50만원 이하',     sub: '1자형 기본 구성' },
  { value: '50~100만원',        emoji: '🪑', label: '50 ~ 100만원',    sub: '1자형 옵션 또는 ㄱ자형 기본' },
  { value: '100~150만원',       emoji: '✨', label: '100 ~ 150만원',   sub: 'ㄱ자형 옵션 또는 ㄷ자형 기본' },
  { value: '150만원 이상',      emoji: '💎', label: '150만원 이상',    sub: 'ㄷ자형 풀옵션 구성' },
];
const OPTION_CARDS = [
  { value: '거울장',     emoji: '🪞', label: '거울장',     price: '+169,000원' },
  { value: '디바이더',   emoji: '📏', label: '디바이더',   price: '+69,000원'  },
  { value: '2단 서랍장', emoji: '🗄️', label: '2단 서랍장', price: '+99,000원'  },
  { value: '3단 서랍장', emoji: '🗄️', label: '3단 서랍장', price: '+119,000원' },
  { value: '4단 서랍장', emoji: '🗄️', label: '4단 서랍장', price: '+160,000원' },
  { value: '바지걸이',   emoji: '👖', label: '바지걸이',   price: '+138,000원' },
  { value: '이불장',     emoji: '🛏️', label: '이불장',     price: '+200,000원' },
  { value: '화장대',     emoji: '💄', label: '화장대',     price: '+250,000원' },
  { value: '아일랜드장', emoji: '🏝️', label: '아일랜드장', price: '+169,000원' },
];

/* P0 신규 카드 세트 (천장 높이 / 설치 지역) — 4구간 압축 (G5) */
const CEILING_CARDS = [
  { value: '천장 높이 2400mm 이하',  emoji: '📏', label: '2400mm 이하',  sub: '일반 아파트' },
  { value: '천장 높이 2400~2700mm', emoji: '📏', label: '2400~2700mm', sub: '중간 층고' },
  { value: '천장 높이 2700mm 이상',  emoji: '📏', label: '2700mm 이상',  sub: '높은 층고' },
  { value: '천장 높이 잘 모르겠어요', emoji: '❓', label: '잘 모르겠어요', sub: '나중에 확인' },
];
const REGION_CARDS = [
  { value: '설치지역 서울',                emoji: '🏙️', label: '서울',            sub: '배송비 2만원' },
  { value: '설치지역 경기',                emoji: '🏘️', label: '경기',            sub: '배송비 3만원~' },
  { value: '설치지역 충청·강원',           emoji: '⛰️', label: '충청·강원',       sub: '배송비 7만원~' },
  { value: '설치지역 전라·경상·부산',      emoji: '🌊', label: '전라·경상·부산',  sub: '배송비 10만원' },
];

function _sendCardValue(value, inlineHost) {
  /* 인라인 모드: 카드 삽입 영역 제거 (말풍선은 유지) */
  if (inlineHost && inlineHost.parentNode) inlineHost.remove();
  $inp.value = value;
  refreshSendBtn();
  $sendBtn.click();
}

/* G3/G6: 카드 그룹 하단에 '✏️ 직접 입력' 칩 공통 부착 */
function _appendManualChip(targetEl, inline) {
  const chips = document.createElement('div');
  chips.className = 'option-quick-chips';
  const chip = document.createElement('button');
  chip.className = 'option-chip';
  chip.textContent = '✏️ 직접 입력';
  chip.onclick = () => {
    if (inline && targetEl && targetEl.parentNode) targetEl.remove();
    else $quickArea.innerHTML = '';
    $inp.focus();
  };
  chips.appendChild(chip);
  targetEl.appendChild(chips);
}

/* 범용 리스트형 카드 렌더 (예산 카드와 동일 레이아웃) — 천장·지역 등 재사용 */
function _renderListCards(cards, opts) {
  const t = _cardTarget(opts);
  const wrap = document.createElement('div');
  wrap.className = 'cards-budget';
  cards.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'card-budget';
    btn.innerHTML = `<div class="cb-emoji"></div><div class="cb-info"><div class="cb-amount"></div><div class="cb-desc"></div></div><div class="cb-arrow">→</div>`;
    btn.querySelector('.cb-emoji').textContent = c.emoji;
    btn.querySelector('.cb-amount').textContent = c.label;
    btn.querySelector('.cb-desc').textContent = c.sub;
    btn.onclick = () => _sendCardValue(c.value, t.inline ? t.el : null);
    wrap.appendChild(btn);
  });
  t.el.appendChild(wrap);
  _appendManualChip(t.el, t.inline);
}

export function setCeilingCards(opts) { _renderListCards(CEILING_CARDS, opts); }
export function setRegionCards(opts)  { _renderListCards(REGION_CARDS,  opts); }

/* 마지막 봇 메시지의 .msg-bubbles-row 안에 카드 삽입용 호스트 생성/회수
   DOM 구조: .msg-group.bot > .msg-body > .msg-bubbles-row > [.msg-bubbles, .msg-meta]
   → 카드는 bubblesRow 안 meta 앞에 삽입해서 [말풍선 → 카드 → 시간] 순서 유지 */
function _inlineHost() {
  const groups = $msgs.querySelectorAll('.msg-group.bot');
  const last = groups[groups.length - 1];
  if (!last) return null;
  const body = last.querySelector('.msg-body');
  if (!body) return null;
  const row = body.querySelector('.msg-bubbles-row');
  if (!row) return null;
  let host = row.querySelector(':scope > .card-insert');
  if (host) { host.innerHTML = ''; return host; }
  host = document.createElement('div');
  host.className = 'card-insert';
  const meta = row.querySelector(':scope > .msg-meta');
  if (meta) row.insertBefore(host, meta);
  else row.appendChild(host);
  return host;
}

/* 카드 컨테이너 결정: inline 옵션이면 마지막 봇 말풍선 안, 아니면 하단 quickArea */
function _cardTarget(opts) {
  if (opts && opts.inline) {
    const host = _inlineHost();
    if (host) return { el: host, inline: true };
  }
  $quickArea.innerHTML = '';
  return { el: $quickArea, inline: false };
}

export function setShapeCards(opts) {
  const t = _cardTarget(opts);
  if (!t.inline) {
    const hint = document.createElement('div');
    hint.className = 'quick-hint-label';
    hint.textContent = '아래 카드에서 선택해 주세요';
    t.el.appendChild(hint);
  }
  const grid = document.createElement('div');
  grid.className = 'cards-shape';
  /* 카드 → API 형태값 매핑 (find-example용) */
  const _shapeApiMap = { '1자형':'ㅡ자', 'ㄱ자형':'ㄱ자', 'ㄷ자형':'ㄷ자', '11자형':'11자' };
  SHAPE_CARDS.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'card-shape';
    btn.innerHTML = `<div class="cs-icon"></div><div class="cs-label"></div><div class="cs-desc"></div>`;
    btn.querySelector('.cs-icon').textContent = c.emoji;
    btn.querySelector('.cs-label').textContent = c.label;
    btn.querySelector('.cs-desc').textContent = c.sub;
    btn.onclick = () => {
      /* 1) 메시지 전송 (기존 동작) */
      _sendCardValue(c.value, t.inline ? t.el : null);
      /* 2) 코드 강제 3D 도면 fetch — AI [SHOW_EXAMPLE] 누락 대비 */
      const _shape = _shapeApiMap[c.value];
      if (!_shape) return;
      fetch(`${SERVER}/api/find-example?shape=${encodeURIComponent(_shape)}&units=&options=`)
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(d => {
          if (d.success && typeof d.url === 'string') {
            const imgUrl = d.url.startsWith('http') ? d.url : `${SERVER}${d.url}`;
            setTimeout(() => {
              addMsg('bot', `${c.label}은 이런 느낌이에요. 참고해서 봐주세요!`);
              addImageMsg(imgUrl, `📐 ${_shape} 예시`);
            }, 600);
          }
        })
        .catch(e => console.warn('형태 카드 예시 자동표시 실패:', e));
    };
    grid.appendChild(btn);
  });
  t.el.appendChild(grid);
  _appendManualChip(t.el, t.inline);
}

export function setBudgetCards(opts) {
  const t = _cardTarget(opts);
  if (!t.inline) {
    const hint = document.createElement('div');
    hint.className = 'quick-hint-label';
    hint.textContent = '아래 카드에서 선택해 주세요';
    t.el.appendChild(hint);
  }
  const wrap = document.createElement('div');
  wrap.className = 'cards-budget';
  BUDGET_CARDS.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'card-budget';
    btn.innerHTML = `<div class="cb-emoji"></div><div class="cb-info"><div class="cb-amount"></div><div class="cb-desc"></div></div><div class="cb-arrow">→</div>`;
    btn.querySelector('.cb-emoji').textContent = c.emoji;
    btn.querySelector('.cb-amount').textContent = c.label;
    btn.querySelector('.cb-desc').textContent = c.sub;
    btn.onclick = () => _sendCardValue(c.value, t.inline ? t.el : null);
    wrap.appendChild(btn);
  });
  t.el.appendChild(wrap);
  _appendManualChip(t.el, t.inline);
}

export function setOptionCards(opts) {
  const t = _cardTarget(opts);
  if (!t.inline) {
    const hint = document.createElement('div');
    hint.className = 'quick-hint-label';
    hint.textContent = '💡 여러 개 선택한 뒤 [선택 완료]를 눌러주세요';
    t.el.appendChild(hint);
  }
  const wrap = document.createElement('div');
  wrap.className = 'cards-option';
  OPTION_CARDS.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'card-option';
    btn.dataset.value = c.value;
    btn.innerHTML = `<span class="co-emoji"></span><div class="co-info"><div class="co-name"></div><div class="co-price"></div></div><div class="co-box">✓</div>`;
    btn.querySelector('.co-emoji').textContent = c.emoji;
    btn.querySelector('.co-name').textContent = c.label;
    btn.querySelector('.co-price').textContent = c.price;
    btn.setAttribute('aria-pressed', 'false');
    /* 다중선택: 클릭 = 체크 토글 (전송 X) */
    btn.onclick = () => {
      const on = btn.classList.toggle('selected');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      _refreshOptConfirm();
    };
    wrap.appendChild(btn);
  });

  /* 선택 완료 버튼 — 선택된 옵션 한 번에 전송 */
  const confirm = document.createElement('button');
  confirm.className = 'co-confirm';
  confirm.disabled = true;
  confirm.textContent = '선택 완료';
  const _refreshOptConfirm = () => {
    const n = wrap.querySelectorAll('.card-option:not(.co-manual).selected').length;
    confirm.disabled = n === 0;
    confirm.textContent = n === 0 ? '선택 완료' : `선택 완료 (${n}개) →`;
  };
  confirm.onclick = () => {
    const picked = [...wrap.querySelectorAll('.card-option:not(.co-manual).selected')]
      .map(el => el.dataset.value).filter(Boolean);
    if (picked.length === 0) return;
    _sendCardValue(picked.join(', ') + ' 추가할게요', t.inline ? t.el : null);
  };

  /* 직접 입력 버튼 */
  const manual = document.createElement('button');
  manual.className = 'card-option co-manual';
  manual.innerHTML = `<span class="co-emoji">✏️</span><div class="co-info"><div class="co-name">직접 입력</div><div class="co-price">원하는 옵션을 자유롭게 적어주세요</div></div>`;
  manual.onclick = () => {
    if (t.inline && t.el.parentNode) t.el.remove();
    else $quickArea.innerHTML = '';
    $inp.focus();
  };
  wrap.appendChild(manual);
  t.el.appendChild(wrap);
  t.el.appendChild(confirm);

  /* 킵3 — 옵션 카드 아래 빠른 응답 칩 3개 */
  const chips = document.createElement('div');
  chips.className = 'option-quick-chips';
  ['괜찮아요', '잘 모르겠어요', '더 알려주세요'].forEach(label => {
    const chip = document.createElement('button');
    chip.className = 'option-chip';
    chip.textContent = label;
    chip.onclick = () => _sendCardValue(label, t.inline ? t.el : null);
    chips.appendChild(chip);
  });
  t.el.appendChild(chips);
}

/* ── 시공 사례 캐러셀 (킵3 디자인) ── */
const PROJECT_SAMPLES = [
  { emoji: '🏠',  title: '강남 ㄱ자형 풀옵션', price: '약 185만원' },
  { emoji: '🛋️', title: '분당 ㄱ자+서랍',    price: '약 145만원' },
  { emoji: '✨',  title: '송파 ㄱ자 미니멀',  price: '약 120만원' },
  { emoji: '🪞',  title: '마포 ㄱ자+거울장',  price: '약 165만원' },
];

export function setProjectCarousel(opts) {
  const t = _cardTarget(opts);
  if (!t.inline) {
    const hint = document.createElement('div');
    hint.className = 'quick-hint-label';
    hint.textContent = '💡 비슷한 시공 사례 — 좌우로 스크롤';
    t.el.appendChild(hint);
  }
  const wrap = document.createElement('div');
  wrap.className = 'project-carousel';
  PROJECT_SAMPLES.forEach(p => {
    const card = document.createElement('div');
    card.className = 'pc-card';
    card.innerHTML = `
      <div class="pc-img"></div>
      <div class="pc-info">
        <div class="pc-title"></div>
        <div class="pc-price"></div>
      </div>
    `;
    card.querySelector('.pc-img').textContent = p.emoji;
    card.querySelector('.pc-title').textContent = p.title;
    card.querySelector('.pc-price').textContent = p.price;
    wrap.appendChild(card);
  });
  t.el.appendChild(wrap);
}

/* ── 인라인 견적 카드 (킵3 디자인) ── */
export function setInlineQuoteFromText(text) {
  /* 견적서 텍스트에서 형태/구성/옵션/배송비/합계 파싱 */
  const layoutM = text.match(/\[설치\s*공간\][^\n]*\n?\s*([^\n]+)/);
  /* H1 fix: 할인 후 금액 우선, 없으면 총 합계, 마지막으로 [금액] 라벨 폴백 */
  const priceM = text.match(/할인\s*후\s*금액\s*[:：]?\s*([\d,]+)\s*원/)
              || text.match(/총\s*합계\s*[:：]?\s*([\d,]+)\s*원/)
              || text.match(/\[금액\][\s\S]*?([\d,]+)\s*원/);
  if (!priceM) { setQuick([]); return; }

  /* 인라인 호스트 우선, 없으면 quickArea */
  const host = _inlineHost();
  const container = host || (function(){ $quickArea.innerHTML=''; return $quickArea; })();

  const card = document.createElement('div');
  card.className = 'inline-quote';
  card.innerHTML = `
    <div class="iq-header"><div class="iq-dot"></div><div class="iq-title">예상 견적서</div></div>
    <div class="iq-body"></div>
    <div class="iq-total">
      <span class="iqt-label">예상 합계</span>
      <span class="iqt-price"></span>
    </div>
    <button class="iq-cta">📄 예상 견적서 받기 →</button>
  `;
  const body = card.querySelector('.iq-body');
  const addRow = (label, val) => {
    if (!val) return;
    const row = document.createElement('div');
    row.className = 'iq-row';
    row.innerHTML = `<span></span><span class="val"></span>`;
    row.children[0].textContent = label;
    row.children[1].textContent = val;
    body.appendChild(row);
  };

  /* 형태 */
  if (layoutM) addRow('형태', layoutM[1].trim());

  /* 기본 구성 (행거 + 선반 또는 텍스트에서 파싱) */
  let baseStr = '행거';
  if (/선반/.test(text)) baseStr += ' + 선반';
  addRow('기본 구성', baseStr);

  /* 옵션 — 거울장/서랍장/디바이더/바지걸이/이불장/아일랜드장/화장대 등 매칭 */
  const OPTION_PATTERNS = [
    { name: '거울장',     re: /거울장[^0-9]{0,15}([\d,]+)\s*원/ },
    { name: '디바이더',   re: /디바이더[^0-9]{0,15}([\d,]+)\s*원/ },
    { name: '2단 서랍장', re: /2\s*단\s*서랍[^0-9]{0,15}([\d,]+)\s*원/ },
    { name: '3단 서랍장', re: /3\s*단\s*서랍[^0-9]{0,15}([\d,]+)\s*원/ },
    { name: '4단 서랍장', re: /4\s*단\s*서랍[^0-9]{0,15}([\d,]+)\s*원/ },
    { name: '바지걸이',   re: /바지걸이[^0-9]{0,15}([\d,]+)\s*원/ },
    { name: '이불장',     re: /이불장[^0-9]{0,15}([\d,]+)\s*원/ },
    { name: '화장대',     re: /화장대[^0-9]{0,15}([\d,]+)\s*원/ },
    { name: '아일랜드장', re: /아일랜드장[^0-9]{0,15}([\d,]+)\s*원/ },
  ];
  OPTION_PATTERNS.forEach(op => {
    const m = text.match(op.re);
    if (m) addRow(op.name, `+${m[1]}원`);
  });

  /* 배송비 */
  const shipM = text.match(/배송비\s*[:：]?\s*([\d,]+)\s*원/);
  if (shipM) addRow('배송비', `${shipM[1]}원 별도`);
  else if (/배송비/.test(text)) addRow('배송비', '지역 확인 필요');

  card.querySelector('.iqt-price').textContent = `약 ${(Number(priceM[1].replace(/,/g, '')) / 10000).toFixed(0)}만원`;
  card.querySelector('.iq-cta').onclick = async () => {
    /* 클릭 → 채팅 그 자리에서 예상 견적서 PNG 이미지 생성 (폼 이동 X) */
    const cta = card.querySelector('.iq-cta');
    cta.disabled = true;
    const _orig = cta.textContent;
    cta.textContent = '견적서 생성 중…';
    try {
      const quoteEl = await renderQuoteImage(text);
      card.replaceWith(quoteEl);
      scrollOrPreview('루마네', '예상 견적서');
    } catch (e) {
      console.error('견적서 PNG 생성 실패:', e);
      cta.disabled = false;
      cta.textContent = _orig;
    }
  };
  container.appendChild(card);
}

/* ── AI 응답에서 퀵 버튼 자동 감지 ── */
export function updateQuickFromText(text) {
  /* 견적서 완료 텍스트면 인라인 견적 카드 표시 */
  const isQuote = /\[설치\s*공간\]/.test(text) && /\[금액\]/.test(text);
  if (isQuote) { setInlineQuoteFromText(text); return; }

  /* 시공 사례 안내 */
  if (/(비슷한.*사례|시공.*사례|참고.*사례|이런.*경우)/.test(text)) {
    setProjectCarousel({ inline: true }); return;
  }

  /* 도면·예시(3D) 안내 — 루마네가 "보여드릴까요?" 류로 물을 때 (지침17: '3D 도면' 표현 금지) */
  if (/(도면|예시\s*이미지|구성\s*예시|예시).*(보여\s*드릴|보여\s*줄|보여\s*드릴까|보여\s*드려|볼래|보실래|보시겠|드릴까요|원하시|받아\s*보|보내\s*드릴까)/.test(text)) {
    setQuick(['네, 예시 보여주세요', '괜찮아요'], true); return;
  }

  /* ①②③ 스타일 선택지 자동 감지 */
  const circled = '①②③④⑤⑥⑦⑧⑨⑩';
  const choiceLines = text.split('\n').filter(l => circled.includes(l.trim()[0]));
  if (choiceLines.length >= 2) {
    /* 선택지 내용이 형태 관련이면 SHAPE_CARDS로 라우팅 (아이콘 카드 일관 노출) */
    const _shapeKW = /(한쪽\s*벽|한\s*벽|코너|두\s*벽|세\s*벽|세벽|마주|두\s*줄|양면|일\s*자|1\s*자|ㄱ\s*자|ㄷ\s*자|11\s*자|ㅁ\s*자)/;
    const _shapeChoiceHits = choiceLines.filter(l => _shapeKW.test(l)).length;
    if (_shapeChoiceHits >= 2) { setShapeCards({ inline: true }); return; }
    setQuick(choiceLines.map(l => l.trim()), true); return;
  }

  /* ── P0 신규 트리거 (고유명사 앵커링 — 광역 패턴보다 위) ── */
  /* 천장 높이 — 카드 (질문형만: '천장 높이 2400mm군요'식 요약/확인문 오발동 방지) */
  if (/(천장\s*높이는?\s*[?？]|천장\s*높이.*(어떻게|얼마|되세요|되나요|알려|몇\s*(mm|cm|미터))|천장.*몇\s*(mm|cm|미터)\s*(\?|예요|인가요|되)|층고.*(어떻게|얼마|몇|되))/.test(text)) {
    setCeilingCards({ inline: true }); return;
  }
  /* 설치 지역 — 카드 (배송비 산정용, 시/도 수준만) */
  if (/(설치\s*지역|어느\s*지역|지역.*어디|배송.*지역|어디.*거주|어디.*사세요)/.test(text)) {
    setRegionCards({ inline: true }); return;
  }
  /* 형태 질문 — 공간 트리거보다 위 (공간+형태 동시언급 시 형태 우선) */
  const _shapeHits = (text.match(/(일자형|1자형|ㄱ자형|ㄷ자형|11자형|ㅁ자형)/g) || []).length;
  if ((_shapeHits >= 2 && /[?？]|인지|계세요|일까요|하세요|신가요|어떠세요|생각/.test(text)) ||
      /(드레스룸\s*형태|형태.*어떻게|어떤\s*형태|형태.*선택|어느\s*형태|형태로\s*생각|형태.*인지|형태.*계세요|어떤\s*형태로)/.test(text)) {
    setShapeCards({ inline: true }); return;
  }
  /* 설치 공간 — 칩 (광역 '설치.*공간' 제거 — 형태질문 오탐 방지) */
  if (/(어느\s*공간|어떤\s*공간|공간에\s*설치|설치할\s*공간|설치하실\s*공간|어디에\s*설치)/.test(text)) {
    setQuick(['안방', '거실', '작은방', '드레스룸', '베란다'], true); return;
  }
  /* 커튼박스 — 칩 */
  if (/(커튼박스|커튼\s*박스)/.test(text)) {
    setQuick(['있어요', '없어요', '잘 모르겠어요'], true); return;
  }
  /* 각 면 치수 — 직접입력 전용 + 보조칩 2개 (숫자라 카드 부적합) */
  if (/(각\s*면\s*치수|각\s*면.*길이|면\s*길이|치수.*알려|치수.*어떻게|치수.*되|치수.*되세요|면.*치수|가로.*세로.*높이|벽\s*길이|길이.*어떻게|길이.*되세요|길이가?\s*얼마)/.test(text)) {
    setQuick(['📐 측정 방법 알려주세요', '치수를 잘 모르겠어요'], true); return;
  }

  /* 예산 질문 — 카드 UI */
  if (/(예산.*얼마|예산.*어느|얼마.*생각|얼마.*예산|얼마쯤|얼마 정도|희망 금액|희망금액|얼마.*까지)/.test(text)) {
    setBudgetCards({ inline: true }); return;
  }
  /* 견적 요약 확인문 — "이런 구성으로 정리해드릴까요?" 류 (색상·기타 오발동 차단 우선) */
  if (/(정리해\s*드릴|이대로\s*견적|예상\s*견적\s*정리|이\s*구성으로|이런\s*구성으로|이대로\s*진행)/.test(text)) {
    setQuick(['네 정리해주세요', '조금 더 볼게요'], true); return;
  }
  /* 색상 — 좁힘 금지(취향 존중). AI가 특정 색 2개 언급해도, 그 색이 속한 팔레트 전체를 노출. */
  const COLOR_TOKENS = ['솔리드화이트','화이트오크','샴페인골드','다크월넛','스톤그레이','진그레이','민트그린','메이플','블랙','실버','화이트'];
  const FRAME_COLORS = new Set(['화이트','블랙','실버','샴페인골드']);
  const SHELF_COLORS = new Set(['솔리드화이트','화이트오크','메이플','스톤그레이','진그레이','다크월넛','민트그린']);
  let _cScan = text, _cPicked = [];
  for (const _c of COLOR_TOKENS) {
    if (_cScan.includes(_c)) { _cPicked.push(_c); _cScan = _cScan.split(_c).join(' '); }
  }
  /* 견적 요약 안내문(합계/만원/배송비 등)에 색상 단어가 섞여 있어도 색상 칩 띄우지 않음 */
  const _isQuoteSummary = /(합계|만원|견적|배송비|구성으로|예상\s*견적)/.test(text);
  /* 선반·프레임 동시 톤 질문이면 아래 colorFrame이 4종 띄우게 양보 */
  const _isFrameShelfQ = /(선반이랑\s*프레임|프레임이랑\s*선반|톤)/.test(text);
  if (_cPicked.length >= 2 && !_isQuoteSummary && !_isFrameShelfQ && /[?？]|어떤|좋으세요|중에|느낌|골라|선택|어울/.test(text)) {
    const _frameHit = _cPicked.filter(c => FRAME_COLORS.has(c)).length;
    const _shelfHit = _cPicked.filter(c => SHELF_COLORS.has(c)).length;
    if (_shelfHit >= 2 && _frameHit === 0) {
      setQuick(['화이트오크', '솔리드화이트', '메이플', '스톤그레이', '진그레이', '다크월넛', '민트그린'], true); return;
    }
    if (_frameHit >= 2 && _shelfHit === 0) {
      setQuick(['화이트', '블랙', '실버', '샴페인골드'], true); return;
    }
    /* 섞이거나 모호하면 계열 4종 (콘셉트 좁힘) */
    setQuick(['화이트 계열', '그레이 계열', '우드 계열', '블랙 계열'], true); return;
  }
  /* 선반 색상 질문 — 견적서 항목 언급이 아닌 실제 질문만 */
  if (/(선반\s*색상.*어떻게|선반\s*색상.*알려|선반\s*색상.*선택|선반\s*색상.*원하|어떤\s*선반\s*색상|선반\s*색상은)/.test(text)) {
    setQuick(['화이트오크', '솔리드화이트', '메이플', '스톤그레이', '진그레이', '다크월넛', '민트그린'], true); return;
  }
  /* 프레임 색상 질문 — 선반+프레임 동시 톤 질문도 여기서 잡음 (프레임 4종 우선 노출) */
  if (/(프레임\s*색상.*어떻게|프레임\s*색상.*알려|프레임\s*색상.*선택|어떤\s*프레임\s*색|프레임\s*색상은|프레임\s*색상.*원하|선반이랑\s*프레임\s*색상|프레임이랑\s*선반\s*색상|선반.*프레임.*색상.*원하|선반.*프레임.*색상.*톤|프레임.*색상.*톤)/.test(text)) {
    setQuick(['화이트', '블랙', '실버', '샴페인골드'], true); return;
  }
  /* 색상 전반 질문 (선반+프레임 동시 언급 또는 일반 색상 질문) */
  if (/(색상.*골라|색상.*선택|어떤\s*색|원하시는\s*색|색상은|색상\s*어떻게|선반이랑\s*프레임)/.test(text)) {
    setQuick(['화이트 계열', '그레이 계열', '우드 계열', '블랙 계열'], true); return;
  }
  /* 옵션 추가 질문 — 강건화: ① 옵션/구성 + 질문어 OR ② 옵션품목 2개+ 나열 + 질문어 */
  const _optHits = (text.match(/(거울장|디바이더|서랍장|바지걸이|이불장|화장대|아일랜드장)/g) || []).length;
  if (/옵션/.test(text) && /[?？]|있으세요|있을까|있나|원하|어떠세요|생각|필요|추가|넣을|넣고/.test(text)
      || (_optHits >= 2 && /[?？]|있으세요|있을까|있나|생각|어떠세요|필요|추가/.test(text))
      || /(옵션.*추가|어떤\s*옵션|옵션.*뭐|옵션.*선택|옵션.*원하|원하시는?\s*옵션|옵션\s*있|옵션이?\s*있으세요|옵션.*궁금|옵션은\?|구성.*원하|뭐\s*넣|추가.*원하시는)/.test(text)) {
    setOptionCards({ inline: true }); return;
  }
  /* 선반 단수 질문 */
  if (/(선반.*몇\s*단|선반.*단수|몇\s*단으로|단수.*어떻게|단수.*선택|몇단)/.test(text)) {
    setQuick(['5단', '6단', '7단', '코너 5단', '코너 6단', '코너 7단'], true); return;
  }
  if (/(개인정보\s*수집|동의해\s*주시겠어요)/.test(text)) {
    setQuick(['동의합니다', '동의하지 않습니다'], true, { allowManual: false }); return;
  }
  if (/(맞으신가요|확인해\s*주시면\s*접수)/.test(text)) {
    setQuick(['네, 맞아요! 접수해주세요', '수정할 내용이 있어요'], true, { allowManual: false }); return;
  }
  setQuick([]);
}

/* ── 서버 상태 배너 ── */
export function setBanner(type, msg = '') {
  $banner.className = 'banner' + (type ? ' ' + type : '');
  $banner.textContent = msg;
}

/* ── 헤더 상태 텍스트 ── */
export function setStatusText(text) {
  $statusTxt.textContent = text;
  const $pcStatus = document.getElementById('pcStatusText');
  if ($pcStatus) $pcStatus.textContent = text;
}

/* ── 날짜 구분선 초기화 ── */
export function initDateSep(text) {
  const el = document.getElementById('dateSep');
  if (el) el.textContent = text;
}

/* ── 새 날짜 구분선 삽입 ── */
export function appendDateSep(text) {
  const sep = document.createElement('div');
  sep.className = 'date-sep';
  sep.textContent = text;
  $msgs.appendChild(sep);
}

/* ── 메시지 목록 초기화 ── */
export function clearMessages() {
  $msgs.innerHTML = '';
}

/* 상담원이 읽음 → 모든 읽음 "1" 제거 */
export function clearReadReceipts() {
  $msgs.querySelectorAll('.read-receipt').forEach(el => el.remove());
}

/* ================================================================
   이모티콘 피커
================================================================ */
function initEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  const btn    = document.getElementById('emojiBtn');
  if (!picker || !btn) return;

  /* 이모티콘 버튼 생성 */
  EMOJIS.forEach(emoji => {
    const item = document.createElement('button');
    item.className = 'emoji-item';
    item.textContent = emoji;
    item.addEventListener('click', () => {
      const pos = $inp.selectionStart ?? $inp.value.length;
      const val = $inp.value;
      $inp.value = val.slice(0, pos) + emoji + val.slice(pos);
      $inp.selectionStart = $inp.selectionEnd = pos + emoji.length;
      $inp.dispatchEvent(new Event('input'));
      $inp.focus();
      picker.classList.remove('open');
    });
    picker.appendChild(item);
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    picker.classList.toggle('open');
  });

  document.addEventListener('click', () => picker.classList.remove('open'));
}

/* ── 이미지 자동 압축 (Canvas API, 클라이언트 사이드) ── */
async function compressImageIfNeeded(file) {
  if (!file.type.startsWith('image/')) return file;   // 이미지 아니면 그대로
  if (file.size < 300 * 1024) return file;            // 300KB 미만은 압축 불필요

  return new Promise(resolve => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      const MAX = 1920;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        const ratio = Math.min(MAX / w, MAX / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const quality = file.type === 'image/png' ? 1 : 0.85;
      canvas.toBlob(blob => {
        if (!blob || blob.size >= file.size) { resolve(file); return; } // 압축 효과 없으면 원본
        const ext  = mime === 'image/png' ? 'png' : 'jpg';
        const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.' + ext;
        resolve(new File([blob], name, { type: mime }));
      }, mime, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(file); };
    img.src = blobUrl;
  });
}

/* ── 대기 중인 첨부 파일 상태 ── */
let pendingFile      = null;
let pendingObjectUrl = null;

export function getPendingFile() { return pendingFile; }

export function clearPendingFile() {
  if (pendingObjectUrl) { URL.revokeObjectURL(pendingObjectUrl); pendingObjectUrl = null; }
  pendingFile = null;
  const bar = document.getElementById('attachBar');
  if (bar) bar.style.display = 'none';
  refreshSendBtn();
}

export async function uploadFilePending(onDone) {
  if (!pendingFile) return;
  const file = pendingFile;
  clearPendingFile();
  await uploadFile(file, onDone);
}

async function showAttachBar(rawFile) {
  const file = await compressImageIfNeeded(rawFile);
  pendingFile = file;
  if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
  pendingObjectUrl = URL.createObjectURL(file);

  const bar = document.getElementById('attachBar');
  if (!bar) return;

  const isImg = file.type.startsWith('image/');

  /* innerHTML 두 번 쓰기 대신 DOM API로 구성 — 이벤트 핸들러 손실 방지 */
  bar.innerHTML = '';

  if (isImg) {
    const thumb = document.createElement('img');
    thumb.src = pendingObjectUrl;
    thumb.className = 'attach-thumb';
    thumb.id = 'attachThumb';
    thumb.alt = '';
    thumb.title = '클릭하면 크게 보기';
    thumb.addEventListener('click', () => showImageLightbox(pendingObjectUrl));
    bar.appendChild(thumb);
  } else {
    const icon = document.createElement('span');
    icon.className = 'attach-icon';
    icon.textContent = '📎';
    bar.appendChild(icon);
  }

  const fname = document.createElement('span');
  fname.className = 'attach-fname';
  fname.textContent = file.name || 'screenshot.png';
  bar.appendChild(fname);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'attach-remove';
  removeBtn.id = 'attachRemoveBtn';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => {
    clearPendingFile();
    $inp.focus();
  });
  bar.appendChild(removeBtn);

  bar.style.display = 'flex';
  refreshSendBtn();
  $inp.focus();
}

/* ── 파일 첨부 버튼 ── */
function initAttachBtn() {
  const btn   = document.getElementById('attachBtn');
  const input = document.getElementById('fileInput');
  if (!btn || !input) return;
  btn.addEventListener('click', () => input.click());
}


/* ── 파일 업로드 후 이미지/파일 메시지 렌더 ── */
export function addFileMsg(url, name, isImage) {
  const group = document.createElement('div');
  group.className = 'msg-group user';

  const bubblesRow = document.createElement('div');
  bubblesRow.className = 'msg-bubbles-row';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = nowStr();
  meta.appendChild(timeEl);

  const bubblesCol = document.createElement('div');
  bubblesCol.className = 'msg-bubbles';

  if (isImage) {
    const fullUrl = url.startsWith('http') ? url : `${SERVER}${url}`;
    const img = document.createElement('img');
    img.src = fullUrl;
    img.className = 'img-example';
    img.alt = name || '첨부 이미지';
    img.style.maxWidth = '220px';
    img.onclick = () => window.open(fullUrl, '_blank', 'noopener,noreferrer');
    bubblesCol.appendChild(img);
  } else {
    const b = document.createElement('div');
    b.className = 'bubble user';
    b.innerHTML = `📎 <a href="${url}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">${esc(name || '파일')}</a>`;
    bubblesCol.appendChild(b);
  }

  bubblesRow.appendChild(meta);
  bubblesRow.appendChild(bubblesCol);
  group.appendChild(bubblesRow);
  $msgs.appendChild(group);
  scrollBottom();
}

/* ── 파일 공통 업로드 처리 ── */
export async function uploadFile(file, onFileSend) {
  if (file.size > 5 * 1024 * 1024) {
    showCopyToast('파일은 5MB 이하만 첨부 가능합니다');
    return;
  }
  showCopyToast('업로드 중...');
  try {
    const fd = new FormData();
    /* 클립보드 이미지는 파일명이 없을 수 있어 기본값 지정 */
    const name = file.name && file.name !== 'image.png' ? file.name : `screenshot-${Date.now()}.png`;
    fd.append('file', file, name);
    /* H2 fix: 서버가 세션 검증 — sessionId 같이 전송 */
    const sid = localStorage.getItem('루마네_세션ID');
    if (sid) fd.append('sessionId', sid);
    const r = await fetch(`${SERVER}/api/upload`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error('업로드 실패');
    const data = await r.json();
    if (data.success) onFileSend(data.url, data.name || name, data.isImage);
  } catch {
    showCopyToast('업로드에 실패했습니다 😢');
  }
}

/* ── 파일 업로드 핸들러 초기화 — 칩 방식 (즉시 업로드 없음) ── */
export function initFileInput() {
  const input = document.getElementById('fileInput');
  if (!input) return;

  /* + 버튼으로 파일 선택 → 칩으로 표시 */
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    showAttachBar(file);
  });

  /* Ctrl+V 클립보드 붙여넣기 → 칩으로 표시 */
  if ($inp) {
    $inp.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find(item => item.type.startsWith('image/'));
      if (!imageItem) return;
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) showAttachBar(file);
    });
  }
}

/* ── 이미지 라이트박스 (크게 보기) ── */
function showImageLightbox(src) {
  document.getElementById('attachLightbox')?.remove();
  const lb = document.createElement('div');
  lb.id = 'attachLightbox';
  lb.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px;';
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:100%;max-height:100%;border-radius:10px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.6);';
  lb.appendChild(img);
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}
