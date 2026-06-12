/* ================================================================
   admin-live-messages.js — 라이브 세션 메시지 + 견적 요약 (Stage 4-4: 분리)

   - 선택된 라이브 세션의 메시지 패널 렌더링
   - 메시지 폴링 (1초 간격, 선택 세션만)
   - 견적 요약 (옵션 가격·치수·색상·합계 추출)
   - 메시지 영역 스크롤 관리

   주요 함수:
   - selectLiveSession (세션 클릭 시 패널 활성화)
   - fetchLiveSessionMsgs (1초 폴링)
   - renderLiveChatPanel (메인 렌더링)
   - renderLiveSummary, toggleLiveSummary (견적 요약)
   - calcEstimate, extractFieldsFromConversation, extractSessionFields, buildConversationSummary
   - updateScrollBtn, scrollLiveMsgsToBottom, initLiveMsgsScrollListener

   의존:
   - admin-state.js: liveSelectedId, liveAdminMode, _liveSelectedByClick,
     _selectedSavedConvId, _seenMsgCounts (read), _saveSeenCount, etc.
   - admin-config.js: SERVER, adminHeaders, escAdmin, escAttr, timeSince
   - admin-live.js (런타임): _seenMsgCounts, _saveSeenCount, markSessionSeen,
     _getSeenSessions, fetchLiveSessions
   - admin-live-sessions.js: renderLiveSessionList
   - admin-mode.js (Stage 4-5): initAdminFileUpload, initAdminPaste,
     initAdminSearch, initAdminCtxMenuListener, sendAdminTyping, ...
   - admin.js: showToast

   admin.html 로드 순서: ... live-sessions → live-messages → admin-mode → live → ...
================================================================ */

async function selectLiveSession(sessionId, byClick = false) {
  clearInterval(liveMsgPollTimer);
  liveMsgPollTimer = null;
  liveSelectedId = sessionId;
  setLiveSelectedByClick(byClick);
  if (byClick) markSessionSeen(sessionId);

  // 라이브 세션은 conv_id 없음 → 메모 패널 숨김
  if (typeof window.lvHideMemoPanel === 'function') window.lvHideMemoPanel();

  await fetchLiveSessionMsgs();

  // await 동안 다른 세션이 선택됐으면 타이머 설정하지 않음 (stale 방지)
  if (liveSelectedId !== sessionId) return;

  // 스크롤 이벤트 리스너 초기화 (1회)
  initLiveMsgsScrollListener();

  // 첫 진입 시 항상 맨 아래로 (레이아웃 계산 후)
  requestAnimationFrame(() => {
    const msgs = document.getElementById('liveMsgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    updateScrollBtn(false);
  });

  liveMsgPollTimer = setInterval(fetchLiveSessionMsgs, 1000);
  fetchLiveSessions();

  // 모바일: 채팅 패널 전체화면으로 전환 후 스크롤
  if (window.innerWidth < 768) {
    document.querySelector('.live-split')?.classList.add('session-selected');
    setTimeout(() => {
      const msgs = document.getElementById('liveMsgs');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }, 50);
  }
}

// 모바일: 목록으로 뒤로가기

/**
 * 선택된 세션의 메시지를 가져와 패널에 표시
 */
async function fetchLiveSessionMsgs() {
  if (!liveSelectedId || !serverOnline) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const res = await fetch(
      `${SERVER}/api/admin/session/${encodeURIComponent(liveSelectedId)}`,
      { headers: adminHeaders() }
    );
    if (!res.ok) return;
    const data = await res.json();
    // 실시간으로 열람 중인 세션은 항상 읽음 처리 (카톡처럼 보는 중에는 배지 안 뜸)
    // 사용자가 직접 클릭한 세션만 자동 읽음 (자동 선택은 빨간 NEW 유지)
    if (_liveSelectedByClick) {
      const sessData = _cachedLiveSessions.find(s => String(s.id) === String(liveSelectedId));
      if (sessData) _saveSeenCount(String(liveSelectedId), sessData.messageCount ?? 0);
    }
    renderLiveChatPanel(data.session);
  } catch { /* 무시 */ }
}

/* ── hex 색상 → rgba 변환 (브라우저 호환성 보장) ── */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── 단가 계산 (참고용 개략 견적) ── */
const _OPT_PRICES = [
  { re: /이불긴장/,                                price: 350_000, label: '이불긴장' },
  { re: /이불장/,                                  price: 200_000, label: '이불장' },
  { re: /화장대/,                                  price: 250_000, label: '화장대' },
  { re: /아일랜드장.{0,5}손잡이|손잡이.{0,5}아일랜드장/, price: 219_000, label: '아일랜드장(손잡이)' },
  { re: /아일랜드장/,                              price: 169_000, label: '아일랜드장' },
  { re: /거울장/,                                  price: 169_000, label: '거울장' },
  { re: /4단\s*서랍/,                              price: 160_000, label: '4단서랍' },
  { re: /3단\s*서랍/,                              price: 119_000, label: '3단서랍' },
  { re: /2단\s*서랍/,                              price:  99_000, label: '2단서랍' },
  { re: /서랍(?!장)/,                              price:  99_000, label: '서랍(2단추정)' },
  { re: /바지걸이/,                                price: 138_000, label: '바지걸이' },
  { re: /디바이더/,                                price:  69_000, label: '디바이더' },
  { re: /7단\s*코너/,                              price: 120_000, label: '7단코너선반' },
  { re: /6단\s*코너/,                              price:  90_000, label: '6단코너선반' },
  { re: /5단\s*코너/,                              price:  60_000, label: '5단코너선반' },
  { re: /7단\s*선반/,                              price:  80_000, label: '7단선반' },
  { re: /6단\s*선반/,                              price:  60_000, label: '6단선반' },
  { re: /5단\s*선반/,                              price:  40_000, label: '5단선반' },
];

function calcEstimate(fields) {
  const sizeRaw = fields.공간사이즈 || '';
  const layout  = fields.형태 || '';
  const optRaw  = fields.추가옵션 || '';

  // 공간사이즈에서 3자리 이상 숫자 추출 (mm 단위 가정)
  const nums = sizeRaw.replace(/[×xX×]/g, ' ').match(/\d{3,4}/g) || [];
  const w = parseInt(nums[0] || '0', 10); // 가로
  const d = parseInt(nums[1] || '0', 10); // 세로(깊이)

  let totalMm = 0;
  if (w > 0) {
    if (/ㄷ|U자|U형/.test(layout))       totalMm = w + d * 2;
    else if (/ㄱ|L자|L형/.test(layout))  totalMm = w + d;
    else if (/ㅁ|사방/.test(layout))     totalMm = (w + d) * 2;
    else                                 totalMm = w; // 일자 or unknown
  }

  const totalCm = totalMm / 10;
  const hangerUnits = Math.ceil(totalCm / 10);
  const hangerPrice = hangerUnits * 10_000;

  // 옵션 파싱 (없음/없어요 → skip)
  const optItems = [];
  if (optRaw && !/없어요|없음|없습|아니오|아니요/i.test(optRaw)) {
    for (const o of _OPT_PRICES) {
      if (o.re.test(optRaw)) optItems.push(o);
    }
  }
  const optTotal = optItems.reduce((s, o) => s + o.price, 0);
  const total = hangerPrice + optTotal;

  return { totalCm, hangerPrice, optItems, optTotal, total, hasDim: totalMm > 0 };
}

/**
 * 주문서 없을 때 대화 전체에서 필드 추출 (베스트에포트)
 */
function extractFieldsFromConversation(messages) {
  const msgs = messages || [];
  // 극단적으로 긴 대화 방어 — 앞 20000자만 사용
  const allText  = msgs.map(m => String(m.content || '')).join('\n').slice(0, 20000);
  const userText = msgs.filter(m => m.role === 'user').map(m => String(m.content || '')).join('\n').slice(0, 20000);
  const botText  = msgs.filter(m => m.role === 'assistant').map(m => String(m.content || '')).join('\n').slice(0, 20000);

  // 설치지역: 시·도 + 시·군·구 → 단독 시·군·구 순서로 추출
  let 설치지역 = null;
  const regionM = allText.match(
    /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n,]{0,10}?([가-힣]+[시군구])/
  );
  if (regionM) {
    // regionM[0] 대신 캡처그룹 조합으로 불필요한 조사 제거
    설치지역 = (regionM[1] + ' ' + regionM[2]).trim().slice(0, 50);
  } else {
    // 단어 경계 확인 — "보여주시면" 같은 오탐 방지, 최소 3자 이상
    const cityM = allText.match(/(?<![가-힣])([가-힣]{3,6}[시군구])(?![가-힣])/);
    if (cityM) 설치지역 = cityM[1];
  }

  // 형태
  let 형태 = null;
  const shapeM = allText.match(/(ㄷ자형|ㄱ자형|11자형|일자형|ㄴ자형|ㄷ\s*자|ㄱ\s*자|일\s*자)/);
  if (shapeM) 형태 = shapeM[1].replace(/\s/g, '');

  // 공간사이즈: 가로/세로/높이 mm 패턴 우선, 없으면 3~4자리 숫자 3개
  let 공간사이즈 = null;
  const sizeM1 = allText.match(/가로[:\s]*(\d{3,4})[^\d]{0,20}세로[:\s]*(\d{3,4})[^\d]{0,20}높이[:\s]*(\d{3,4})/);
  if (sizeM1) {
    공간사이즈 = `${sizeM1[1]} × ${sizeM1[2]} × ${sizeM1[3]} (mm)`;
  } else {
    const sizeM2 = allText.match(/(\d{3,4})[^\d\n]{0,15}(\d{3,4})[^\d\n]{0,15}(\d{3,4})/);
    if (sizeM2) 공간사이즈 = `${sizeM2[1]} × ${sizeM2[2]} × ${sizeM2[3]}`;
  }

  // 추가옵션
  const optPairs = [
    [/거울장/, '거울장'], [/아일랜드장/, '아일랜드장'], [/화장대/, '화장대'],
    [/[2-4]단\s*서랍|서랍장?/, '서랍'], [/이불장/, '이불장'],
    [/바지걸이/, '바지걸이'], [/디바이더/, '디바이더'],
  ];
  const foundOpts = optPairs.filter(([re]) => re.test(allText)).map(([, label]) => label);
  const 추가옵션 = foundOpts.length ? foundOpts.join(', ') : null;

  // 선반색상 (복합어 우선)
  const shelfColors = ['다크월넛', '화이트오크', '스톤그레이', '진그레이', '솔리드화이트'];
  const 선반색상 = shelfColors.find(c => allText.includes(c)) || null;

  // 프레임색상 (화이트오크와 혼동 방지)
  let 프레임색상 = null;
  if (/블랙/.test(allText))              프레임색상 = '블랙';
  else if (/실버/.test(allText))         프레임색상 = '실버';
  else if (/골드/.test(allText))         프레임색상 = '골드';
  else if (/화이트(?!오크)/.test(allText)) 프레임색상 = '화이트';

  // 이름: 고객이 직접 말했거나 bot이 문장 맨 앞에서 "OO님" 으로 부른 경우만 인정
  // "안녕하세요 고객님"의 "하세요" 같은 오탐 방지
  let 이름 = null;
  const nameFromUser = userText.match(/(?:이름|성함)[은는이가]?\s*([가-힣]{2,4})/);
  if (nameFromUser && !/고객|모르|없|미정|비밀/.test(nameFromUser[1])) {
    이름 = nameFromUser[1];
  } else {
    // bot 메시지 줄 첫 단어 + 님 패턴 (예: "홍길동님, 안녕하세요")
    const nameFromBot = botText.match(/^([가-힣]{2,4})\s*님[,\s!]/m);
    if (nameFromBot) 이름 = nameFromBot[1];
  }

  // 연락처: 휴대폰 번호
  let 연락처 = null;
  const phoneM = allText.match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/);
  if (phoneM) 연락처 = phoneM[0].replace(/\s/g, '');

  return { 이름, 연락처, 설치지역, 공간사이즈, 형태, 추가옵션, 프레임색상, 선반색상, 요청사항: null };
}

/**
 * AI가 출력한 주문서/견적서에서 필드 추출.
 * 주문서 없으면 대화 전체에서 베스트에포트 추출.
 */
function extractSessionFields(messages) {
  const msgs = messages || [];
  const get = (text, re) => {
    const m = text.match(re);
    return (m && m[1] != null) ? m[1].trim().slice(0, 200) : null;
  };

  // '총 합계' 또는 '주문서'가 포함된 AI 메시지만 주문서로 인정 (최신 우선)
  const orderMsg = [...msgs].reverse().find(m =>
    m.role === 'assistant' && m.content &&
    (m.content.includes('총 합계') || m.content.includes('주문서'))
  );

  if (orderMsg) {
    const text = orderMsg.content;
    const sizeM = text.match(/좌측[:\s]+([^\n/]{1,100})\/\s*정면[:\s]+([^\n/]{1,100})\/\s*우측[:\s]+([^\n/]{1,100})/);
    const 공간사이즈 = sizeM
      ? `좌측 ${sizeM[1].trim()} / 정면 ${sizeM[2].trim()} / 우측 ${sizeM[3].trim()}`
      : get(text, /(?:공간\s*사이즈|사이즈|치수)[:\s*]+([^\n]+)/);
    // ReDoS 방어: 매칭 범위를 최대 5000자로 제한
    const safeText = text.slice(0, 5000);
    const optM = safeText.match(/구성 옵션[^\n]*\n([\s\S]{0,1000}?)(?:\*\*총 합계|총 합계)/);
    const 추가옵션 = optM
      ? optM[1].trim().replace(/\n/g, ' / ').slice(0, 200)
      : get(text, /(?:추가\s*옵션|옵션)[:\s]+([^\n]+)/);
    return {
      이름:       get(text, /성함[:\s]+([^\n]+)/),
      연락처:     get(text, /연락처[:\s]+([^\n]+)/),
      설치지역:   get(text, /(?:주소|설치\s*지역|지역)[:\s]+([^\n]+)/),
      공간사이즈,
      형태:       get(text, /(?:설치\s*형태|드레스룸\s*형태|형태)[:\s]+([^\n]+)/),
      추가옵션,
      프레임색상: get(text, /프레임\s*색상[:\s]+([^\n]+)/),
      선반색상:   get(text, /선반\s*색상[:\s]+([^\n]+)/),
      요청사항:   get(text, /요청\s*사항[:\s]+([^\n]+)/),
    };
  }

  // 주문서 없음 → 대화 전체에서 베스트에포트 추출
  return extractFieldsFromConversation(msgs);
}

// 고객 관심 키워드 — 매 호출마다 재생성하지 않도록 모듈 레벨에 정의
const _SUMMARY_KW = [
  [/거울장/, '거울장'], [/서랍/, '서랍'], [/화장대/, '화장대'],
  [/이불장/, '이불장'], [/바지걸이/, '바지걸이'], [/디바이더/, '디바이더'],
  [/ㄱ자|L자|L형/, 'ㄱ자형'], [/ㄷ자|U자|U형/, 'ㄷ자형'],
  [/ㅁ자|사방/, 'ㅁ자형'], [/일자/, '일자형'],
  [/3[dD]|도면|예시\s*이미지/, '3D 도면 요청'], [/할인/, '할인 문의'],
  [/신규\s*아파트|신축/, '신규아파트'], [/설치\s*기사|설치비/, '설치 문의'],
];

/**
 * 대화 내용을 분석해 상담 단계·관심 키워드·마지막 AI 응답 미리보기 반환
 */
function buildConversationSummary(messages) {
  const msgs = messages || [];
  if (!msgs.length) return null;
  const userMsgs = msgs.filter(m => m.role === 'user');
  const asMsgs   = msgs.filter(m => m.role === 'assistant');

  const lastAi  = [...asMsgs].pop()?.content || '';
  const allUser = userMsgs.map(m => m.content || '').join(' ');

  // 상담 단계 (치수 > 옵션 순서로 판별해야 오분류 방지)
  let stage = '초기 상담';
  let stageColor = '#6b7280';
  if (lastAi.includes('총 합계') || lastAi.includes('주문서')) {
    stage = '견적 완료';    stageColor = '#16a34a';
  } else if (lastAi.includes('프레임') && lastAi.includes('색상')) {
    stage = '색상 확인 중'; stageColor = '#7c3aed';
  } else if (/mm|치수|사이즈|좌측|정면|우측/.test(lastAi)) {
    stage = '치수 수집 중'; stageColor = '#d97706';
  } else if (lastAi.includes('옵션')) {
    stage = '옵션 확인 중'; stageColor = '#7c3aed';
  } else if (userMsgs.length >= 3) {
    stage = '정보 수집 중'; stageColor = '#d97706';
  }

  const keywords = _SUMMARY_KW.filter(([re]) => re.test(allUser)).map(([, label]) => label);

  // 마지막 AI 응답 미리보기 — escAdmin으로 XSS 방어 후 렌더링할 것
  const rawPreview = lastAi.replace(/\*\*/g, '').replace(/\n+/g, ' ').trim();
  const previewTruncated = rawPreview.length > 120;
  const preview = previewTruncated ? rawPreview.slice(0, 120) : rawPreview;

  return { stage, stageColor, keywords, preview, previewTruncated, userCount: userMsgs.length, aiCount: asMsgs.length };
}

function toggleLiveSummary() {
  const body    = document.getElementById('liveSummaryBody');
  const chevron = document.getElementById('liveSummaryChevron');
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display    = collapsed ? '' : 'none';
  chevron.style.transform = collapsed ? '' : 'rotate(180deg)';
}

function renderLiveSummary(sess) {
  const wrap = document.getElementById('liveSummary');
  if (!wrap) return;
  const f = extractSessionFields(sess.messages || []);
  const startedAt = sess.startedAt
    ? new Date(sess.startedAt).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
    : '-';
  const modeLabel = sess.mode === 'admin' ? '<span style="color:#7c3aed;font-weight:700;">👩‍💼 담당자 상담 중</span>' : '<span style="color:#22c55e;font-weight:700;">🤖 AI 응답 중</span>';

  const row = (label, val, required = false) => {
    const empty = !val || val === '-' || val.trim() === '';
    const display = empty ? `<span style="color:#d1d5db;">미수집</span>` : escAdmin(val.length > 60 ? val.slice(0, 60) + '…' : val);
    const dot = required && empty ? `<span style="width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;margin-right:4px;flex-shrink:0;"></span>` : '';
    return `<div style="display:flex;gap:6px;align-items:baseline;min-width:0;padding:2px 0;">
      <span style="font-size:11px;color:#9ca3af;white-space:nowrap;min-width:64px;flex-shrink:0;">${dot}${label}</span>
      <span style="font-size:12.5px;color:#1f2937;word-break:break-all;">${display}</span>
    </div>`;
  };

  const body = document.getElementById('liveSummaryBody');
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px;">
      ${row('공간사이즈', f.공간사이즈, true)}
      ${row('드레스룸형태', f.형태, true)}
      <div style="display:flex;gap:6px;align-items:baseline;padding:2px 0;">
        <span style="font-size:11px;color:#9ca3af;white-space:nowrap;min-width:64px;flex-shrink:0;">접수일시</span>
        <span style="font-size:12.5px;color:#1f2937;">${startedAt}</span>
      </div>
    </div>
    <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e5e7eb;display:flex;gap:6px;align-items:baseline;">
      <span style="font-size:11px;color:#9ca3af;white-space:nowrap;min-width:64px;flex-shrink:0;">현재상태</span>
      <span style="font-size:12.5px;">${modeLabel}</span>
    </div>
    ${(f.추가옵션 || f.프레임색상 || f.선반색상 || f.요청사항) ? `
    <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e5e7eb;display:grid;grid-template-columns:1fr 1fr;gap:0 12px;">
      ${f.추가옵션  ? row('추가옵션',   f.추가옵션)  : ''}
      ${f.프레임색상 ? row('프레임색상', f.프레임색상) : ''}
      ${f.선반색상  ? row('선반색상',   f.선반색상)  : ''}
      ${f.요청사항  ? row('요청사항',   f.요청사항)  : ''}
    </div>` : ''}
    ${(() => {
      const est = calcEstimate(f);
      if (!est.hasDim && est.optItems.length === 0) return '';
      const fmt = n => n.toLocaleString('ko-KR') + '원';
      const hangerRow = est.hasDim
        ? `<div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;">기본행거 ${Math.round(est.totalCm)}cm</span><span>${fmt(est.hangerPrice)}</span></div>`
        : '';
      const optRows = est.optItems.map(o =>
        `<div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;">${o.label}</span><span>${fmt(o.price)}</span></div>`
      ).join('');
      const totalRow = `<div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid #d1d5db;margin-top:4px;padding-top:4px;"><span>합계 (참고)</span><span style="color:#c9a96e;">${fmt(est.total)}</span></div>`;
      return `
      <div style="margin-top:8px;padding:8px 10px;background:#fffbf0;border:1px solid #e8d5a3;border-radius:8px;font-size:12px;line-height:1.8;">
        <div style="font-size:11px;font-weight:600;color:#a07830;margin-bottom:4px;">💰 예상 단가 (참고용)</div>
        ${hangerRow}${optRows}${totalRow}
        <div style="font-size:10px;color:#b0915a;margin-top:3px;">배송비 별도 · 도면 확정 전 기준</div>
      </div>`;
    })()}
    ${(() => {
      const cs = buildConversationSummary(sess.messages || []);
      if (!cs) return '';
      const kwHtml = cs.keywords.length
        ? cs.keywords.map(k => `<span style="font-size:10px;padding:1px 7px;background:#f3f4f6;border-radius:8px;color:#374151;">${escAdmin(k)}</span>`).join('')
        : '';
      const previewHtml = cs.preview
        ? `<div style="font-size:11.5px;color:#6b7280;line-height:1.5;border-left:2px solid #e5e7eb;padding-left:6px;margin-top:4px;">${escAdmin(cs.preview)}${cs.previewTruncated ? '…' : ''}</div>`
        : '';
      return `
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #e5e7eb;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:${hexToRgba(cs.stageColor, 0.12)};color:${escAttr(cs.stageColor)};letter-spacing:-.2px;">${escAdmin(cs.stage)}</span>
          <span style="font-size:10.5px;color:#9ca3af;">고객 ${cs.userCount}회 · AI ${cs.aiCount}회</span>
        </div>
        ${kwHtml ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px;">${kwHtml}</div>` : ''}
        ${previewHtml}
      </div>`;
    })()}
  `;
  wrap.style.display = '';
}

/**
 * 오른쪽 채팅 패널 렌더링
 */
function renderLiveChatPanel(sess) {
  const isAdmin = sess.mode === 'admin';
  liveAdminMode = isAdmin;

  // wasAtBottom을 DOM 변경(renderLiveSummary) 전에 먼저 측정
  const msgs = document.getElementById('liveMsgs');
  const wasAtBottom = msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 30;

  renderLiveSummary(sess);

  document.getElementById('livePanelTitle').textContent =
    `💬 ${sess.customerName || '(이름 미수집)'}`;
  const tk = (window._liveTokenMap || {})[sess.id];
  const tkStr = tk ? ` · 🪙 ₩${tk.costKRW.toLocaleString()} (${tk.totalTokens.toLocaleString()}토큰)` : '';
  document.getElementById('livePanelMeta').textContent =
    `세션 ${String(sess.id).slice(0, 20)}… · 메시지 ${sess.messages.length}개${tkStr}`;

  document.getElementById('livePanelActions').innerHTML = isAdmin
    ? `<button class="btn btn-outline" onclick="releaseSession()" style="font-size:13px;">🤖 AI에게 넘기기</button>`
    : `<button class="btn btn-primary" onclick="takeoverSession()" style="font-size:13px;">👩‍💼 난입하기</button>`;

  msgs.innerHTML = (sess.messages || []).map(m => {
    const isUser     = m.role === 'user';
    const isAdminMsg = m.fromAdmin;

    /* 답장 인용 패턴 감지 */
    const replyMatch = m.content?.match(/^\[답장: (.+?)\]\n([\s\S]*)$/);
    let replyQuoteHtml = '';
    let rawContent = m.content || '';
    if (replyMatch) {
      replyQuoteHtml = `<div style="background:rgba(0,0,0,.08);border-left:3px solid rgba(0,0,0,.25);border-radius:6px;padding:4px 8px;margin-bottom:5px;font-size:11.5px;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escAdmin(replyMatch[1])}</div>`;
      rawContent = replyMatch[2];
    }

    /* 이미지/파일 첨부 패턴 감지 */
    const imgMatch  = rawContent.match(/^\[이미지\]\n(https?:\/\/\S+)$/);
    const fileMatch = rawContent.match(/^\[파일: ([^\]]+)\]\n(https?:\/\/\S+)$/);
    let bubbleInner;
    if (imgMatch) {
      const rawUrl  = imgMatch[1];
      const safeUrl = escAttr(rawUrl);
      if (window._failedImgUrls.has(rawUrl)) {
        bubbleInner = replyQuoteHtml + `<span style="font-size:12px;color:#9ca3af;">[이미지 없음]</span>`;
      } else {
        const jsEscRawUrl = rawUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        bubbleInner = replyQuoteHtml + `<img src="${safeUrl}" style="max-width:200px;border-radius:8px;display:block;cursor:pointer;" onclick="window.open('${safeUrl}','_blank','noopener,noreferrer')" onerror="this.style.display='none';window._failedImgUrls.add('${jsEscRawUrl}')">` +
          `<button onclick="window._downloadImg('${safeUrl}')" class="img-download-btn">⬇ 다운로드</button>`;
      }
    } else if (fileMatch) {
      const fname = fileMatch[1];
      const furl  = fileMatch[2];
      const ext   = fname.split('.').pop().toLowerCase();
      if (/^(mp4|webm|ogg|mov)$/.test(ext)) {
        bubbleInner = replyQuoteHtml + `<video src="${escAttr(furl)}" controls preload="metadata" style="max-width:220px;border-radius:8px;display:block;"></video>`;
      } else if (/^(mp3|wav|ogg|m4a|aac)$/.test(ext)) {
        bubbleInner = replyQuoteHtml + `<audio src="${escAttr(furl)}" controls preload="metadata" style="max-width:220px;display:block;"></audio>`;
      } else {
        bubbleInner = replyQuoteHtml + `📎 <a href="${escAttr(furl)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">${escAdmin(fname)}</a>`;
      }
    } else {
      bubbleInner = replyQuoteHtml + (isAdminMsg ? '<span style="font-size:10px;color:#7c3aed;font-weight:700;display:block;margin-bottom:3px;">담당자</span>' : '') + escAdmin(rawContent);
    }

    const encodedContent = encodeURIComponent(m.content || '');
    const timeStr = (m.ts || m.time) ? fmtLiveTime(m.ts || m.time) : '';
    const timeBadge = timeStr ? `<span style="font-size:10.5px;color:#9ca3af;white-space:nowrap;padding-bottom:3px;flex-shrink:0;">${timeStr}</span>` : '';

    if (isUser) {
      return `
        <div class="live-msg-row" data-role="user" data-content="${encodedContent}"
             style="display:flex;justify-content:flex-end;gap:8px;align-items:flex-start;margin-bottom:8px;">
          <div style="display:flex;align-items:flex-end;gap:5px;max-width:calc(100% - 48px);min-width:0;">
            ${timeBadge}
            <div style="padding:${imgMatch ? '6px' : '10px 13px'};font-size:14.5px;line-height:1.6;word-break:break-word;white-space:pre-wrap;border-radius:16px 16px 2px 16px;background:#7c3aed;color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.08);min-width:0;overflow-wrap:break-word;">${bubbleInner}</div>
          </div>
          <div style="width:40px;height:40px;border-radius:50%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">👤</div>
        </div>
      `;
    } else {
      const senderName = isAdminMsg ? '담당자' : '루마네';
      const avBg = isAdminMsg ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : 'linear-gradient(135deg,#6b7280,#9ca3af)';
      const avIcon = isAdminMsg ? '👩‍💼' : '🤖';
      return `
        <div class="live-msg-row" data-role="${isAdminMsg ? 'admin' : 'bot'}" data-content="${encodedContent}"
             style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;">
          <div style="width:40px;height:40px;border-radius:50%;background:${avBg};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;margin-top:20px;">${avIcon}</div>
          <div style="flex:1;min-width:0;overflow:hidden;">
            <div style="font-size:12.5px;font-weight:700;color:#111827;margin-bottom:4px;padding-left:2px;">${senderName}</div>
            <div style="display:flex;align-items:flex-end;gap:5px;">
              <div style="padding:${imgMatch ? '6px' : '10px 13px'};font-size:14.5px;line-height:1.6;word-break:break-word;white-space:pre-wrap;border-radius:2px 16px 16px 16px;background:${isAdminMsg ? '#ede9fe' : '#fff'};color:#1a1a2e;box-shadow:0 1px 2px rgba(0,0,0,.08);min-width:0;overflow-wrap:break-word;max-width:100%;">${bubbleInner}</div>
              ${timeBadge}
            </div>
          </div>
        </div>
      `;
    }
  }).join('');

  /* 고객 타이핑 표시 */
  const existingTyping = msgs.querySelector('.customer-typing-indicator');
  if (existingTyping) existingTyping.remove();
  if (sess.customerTyping) {
    const typingEl = document.createElement('div');
    typingEl.className = 'customer-typing-indicator';
    typingEl.style.cssText = 'display:flex;align-items:flex-end;gap:8px;justify-content:flex-start;margin-bottom:8px;';
    typingEl.innerHTML = `
      <div style="width:40px;height:40px;border-radius:50%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">👤</div>
      <div style="padding:10px 14px;background:#fff;border-radius:2px 16px 16px 16px;box-shadow:0 1px 2px rgba(0,0,0,.08);display:flex;gap:4px;align-items:center;">
        <span style="width:6px;height:6px;background:#9ca3af;border-radius:50%;animation:typingDot .9s infinite;display:inline-block;"></span>
        <span style="width:6px;height:6px;background:#9ca3af;border-radius:50%;animation:typingDot .9s .2s infinite;display:inline-block;"></span>
        <span style="width:6px;height:6px;background:#9ca3af;border-radius:50%;animation:typingDot .9s .4s infinite;display:inline-block;"></span>
      </div>
    `;
    msgs.appendChild(typingEl);
  }

  if (wasAtBottom) {
    msgs.scrollTop = msgs.scrollHeight;
    updateScrollBtn(false);
  } else {
    /* 스크롤 위에 있을 때: 새 메시지 미리보기 버튼 표시 */
    const lastMsg = (sess.messages || []).filter(m => m.role === 'user').slice(-1)[0];
    const preview = lastMsg ? (lastMsg.content || '').slice(0, 30) : '새 메시지';
    updateScrollBtn(true, preview);
  }

  /* 검색 중이면 하이라이트 재적용 */
  if (_adminSearchOpen) {
    const inp = document.getElementById('adminSearchInput');
    if (inp?.value.trim()) runAdminSearch(inp.value.trim());
  }

  const input       = document.getElementById('liveInput');
  const sendBtn     = document.getElementById('liveSendBtn');
  const uploadBtn   = document.getElementById('adminUploadBtn');
  input.disabled = !isAdmin;
  if (uploadBtn)   uploadBtn.disabled   = !isAdmin;
  refreshAdminSendBtn();
  input.placeholder = isAdmin
    ? '고객에게 직접 메시지를 입력하세요...'
    : '난입하기를 눌러야 입력 가능합니다';

  if (isAdmin) input.focus();
}

function updateScrollBtn(show, previewText) {
  const btn = document.getElementById('scrollToBottomBtn');
  if (!btn) return;
  if (show) {
    const preview = document.getElementById('scrollToBottomPreview');
    if (preview && previewText) {
      const trimmed = previewText.replace(/\s+/g, ' ').trim();
      preview.textContent = '↓ ' + (trimmed.length > 25 ? trimmed.slice(0, 25) + '…' : trimmed);
    }
    btn.style.display = 'block';
  } else {
    btn.style.display = 'none';
  }
}

function scrollLiveMsgsToBottom() {
  const msgs = document.getElementById('liveMsgs');
  if (msgs) {
    msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
  }
  updateScrollBtn(false);
}

function initLiveMsgsScrollListener() {
  const msgs = document.getElementById('liveMsgs');
  if (!msgs || msgs._scrollListenerAttached) return;
  msgs._scrollListenerAttached = true;
  msgs.addEventListener('scroll', () => {
    const atBottom = msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 30;
    if (atBottom) updateScrollBtn(false);
  });
}
