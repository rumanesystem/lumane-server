/* ================================================================
   Admin 메인 — 서버 확인, 데이터 로드, UI 업데이트, 탭 전환
================================================================ */

/* ================================================================
   서버 상태 확인 & 데이터 로드
================================================================ */

async function checkServer() {
  try {
    const res  = await fetch(`${SERVER}/api/health`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();

    if (data.status === 'ok') {
      serverOnline = true;
      document.getElementById('serverBadge').className    = 'server-badge online';
      document.getElementById('serverStatus').textContent = '서버 연결됨';
      await Promise.all([loadQuotes(), loadStats()]);
    }
  } catch {
    serverOnline = false;
    document.getElementById('serverBadge').className    = 'server-badge offline';
    document.getElementById('serverStatus').textContent = '서버 오프라인';
    loadDemoData();
  }
}

async function loadStats() {
  try {
    const res  = await fetch(`${SERVER}/api/admin/stats`, { headers: adminHeaders() });
    if (!res.ok) return;
    const d = await res.json();
    document.getElementById('statToday').textContent    = (d.today  ?? '—') + '건';
    document.getElementById('statWeek').textContent     = (d.week   ?? '—') + '건';
    document.getElementById('statMonth').textContent    = (d.month  ?? '—') + '건';
    document.getElementById('statTotal').textContent    = (d.total  ?? '—') + '건';
    document.getElementById('statNewToday').textContent = `신규 ${d.newToday ?? '—'}명`;
    document.getElementById('statNewWeek').textContent  = `신규 ${d.newWeek  ?? '—'}명`;
    document.getElementById('statNewMonth').textContent = `신규 ${d.newMonth ?? '—'}명`;
    // 오늘 방문자 카드 (피드백 반영)
    const visitorsEl = document.getElementById('statVisitorsToday');
    const engagedEl  = document.getElementById('statEngagedToday');
    if (visitorsEl) visitorsEl.textContent = (d.visitorsToday ?? '—') + '명';
    if (engagedEl) {
      const v = Number(d.visitorsToday) || 0;
      const e = Number(d.engagedToday) || 0;
      const pct = v > 0 ? Math.round((e / v) * 100) : 0;
      engagedEl.textContent = v > 0
        ? `그 중 대화: ${e}명 (${pct}%)`
        : `그 중 대화: ${e}명`;
    }
  } catch { /* 통계 로드 실패 시 무시 */ }
}

const KST = 9 * 60 * 60 * 1000;
const toKSTDate = iso => {
  if (!iso) return '날짜 미상';
  const d = new Date(new Date(iso).getTime() + KST);
  return d.toISOString().slice(0, 10);
};
const toKSTTime = iso => {
  if (!iso) return '--:--';
  const d = new Date(new Date(iso).getTime() + KST);
  return d.toISOString().slice(11, 16);
};

let _statSessions = [];
let _statLabel = '';

let _statRequestId = 0;

async function openStatDetail(period, label) {
  const myId = ++_statRequestId;
  const body  = document.getElementById('statDetailBody');
  _statLabel = label;
  _monthSessionsCache = null;
  _monthNavLevel = 0;
  document.getElementById('statDetailTitle').textContent = label;
  document.getElementById('statDetailCount').textContent = '불러오는 중...';
  document.getElementById('statDetailBack').textContent = '‹ 뒤로';
  document.getElementById('statDetailBack').onclick = () => switchTab('dashboard');
  body.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;">로딩 중...</div>';
  switchTab('stat-detail');

  try {
    const res = await fetch(`${SERVER}/api/admin/stat-sessions?period=${encodeURIComponent(period)}`, { headers: adminHeaders() });
    if (myId !== _statRequestId) return;
    if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
    const data = await res.json();
    if (myId !== _statRequestId) return;
    _statSessions = data.sessions || [];
    document.getElementById('statDetailCount').textContent = `총 ${_statSessions.length}건`;
    if (period === 'today') {
      showStatDay(toKSTDate(new Date().toISOString()));
      /* 오늘 상담은 날짜 목록 단계 없이 바로 목록이므로 뒤로 = 대시보드 */
      const backBtn = document.getElementById('statDetailBack');
      backBtn.textContent = '‹ 뒤로';
      backBtn.onclick = () => switchTab('dashboard');
    } else {
      body.innerHTML = renderStatDaySummary(_statSessions);
    }
  } catch {
    if (myId !== _statRequestId) return;
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">불러오기 실패</div>';
  }
}

function renderStatDaySummary(sessions) {
  if (sessions.length === 0) {
    return '<div style="text-align:center;padding:60px 0;color:#9ca3af;font-size:14px;">해당 기간에 상담 내역이 없습니다</div>';
  }

  const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
  const groups = {};
  sessions.forEach(s => {
    const date = toKSTDate(s.started_at);
    if (!groups[date]) groups[date] = [];
    groups[date].push(s);
  });

  return Object.entries(groups).map(([date, list]) => {
    const dow = DAY_KO[new Date(date + 'T00:00:00+09:00').getDay()];
    const mmdd = date.slice(5).replace('-', '/');
    return `
      <div onclick="showStatDay('${escAttr(date)}')"
        style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-radius:12px;background:#f9fafb;margin-bottom:8px;border:1px solid #f3f4f6;cursor:pointer;transition:background .15s;"
        onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='#f9fafb'">
        <div style="font-size:14px;font-weight:600;color:#111827;">${mmdd}(${dow})</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:13px;font-weight:700;color:#7c3aed;">${list.length}건</span>
          <span style="font-size:16px;color:#9ca3af;">›</span>
        </div>
      </div>`;
  }).join('');
}

function showStatDay(date) {
  const list = _statSessions.filter(s => toKSTDate(s.started_at) === date);
  const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
  const dow = DAY_KO[new Date(date + 'T00:00:00+09:00').getDay()];
  const mmdd = date.slice(5).replace('-', '/');

  document.getElementById('statDetailTitle').textContent = `${mmdd}(${dow}) 상담`;
  document.getElementById('statDetailCount').textContent = `${list.length}건`;
  const backBtn = document.getElementById('statDetailBack');
  backBtn.textContent = `‹ ${_statLabel}`;
  backBtn.onclick = () => {
    document.getElementById('statDetailTitle').textContent = _statLabel;
    document.getElementById('statDetailCount').textContent = `총 ${_statSessions.length}건`;
    backBtn.textContent = '‹ 뒤로';
    backBtn.onclick = () => switchTab('dashboard');
    document.getElementById('statDetailBody').scrollTop = 0;
    document.getElementById('statDetailBody').innerHTML = renderStatDaySummary(_statSessions);
  };

  const body = document.getElementById('statDetailBody');
  if (list.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:60px 0;color:#9ca3af;font-size:14px;">상담 내역이 없습니다</div>';
    return;
  }
  body.innerHTML = list.map(s => `
    <div onclick="openHistoryDetail('${escAttr(String(s.id))}', ${s.is_test ? 1 : 0})"
      style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:#f9fafb;margin-bottom:8px;border:1px solid #f3f4f6;cursor:pointer;transition:background .15s;"
      onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='#f9fafb'">
      <div style="font-size:12px;color:#9ca3af;width:36px;flex-shrink:0;">${toKSTTime(s.started_at)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#111827;">${escAdmin(s.customer_name || '(이름 미수집)')}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px;">${escAdmin(s.phone || '연락처 없음')}${s.region ? ' · ' + escAdmin(s.region) : ''}${s.layout ? ' · ' + escAdmin(s.layout) : ''}</div>
      </div>
      <span style="font-size:16px;color:#9ca3af;flex-shrink:0;">›</span>
    </div>
  `).join('');
}

function statDetailGoBack() {
  if (_monthSessionsCache !== null && _monthNavLevel === 2) {
    renderWeeklyBreakdown(_monthSessionsCache);
    return;
  }
  switchTab('dashboard');
}

/* ── 이번 달 3단계 드릴다운 ── */
let _monthSessionsCache = null;
let _monthNavLevel = 0;

async function openMonthDetail() {
  const myId = ++_statRequestId;
  const body  = document.getElementById('statDetailBody');

  _monthSessionsCache = null;
  _monthNavLevel = 1;
  document.getElementById('statDetailTitle').textContent = '이번 달 상담';
  document.getElementById('statDetailCount').textContent = '불러오는 중...';
  const backBtn = document.getElementById('statDetailBack');
  backBtn.textContent = '‹ 뒤로';
  backBtn.onclick = () => switchTab('dashboard');
  body.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;">로딩 중...</div>';
  switchTab('stat-detail');

  try {
    const res = await fetch(`${SERVER}/api/admin/stat-sessions?period=month`, { headers: adminHeaders() });
    if (myId !== _statRequestId) return;
    if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
    const data = await res.json();
    if (myId !== _statRequestId) return;
    _monthSessionsCache = data.sessions || [];
    renderWeeklyBreakdown(_monthSessionsCache);
  } catch {
    if (myId !== _statRequestId) return;
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">불러오기 실패</div>';
    document.getElementById('statDetailCount').textContent = '';
  }
}

function getWeekOfMonth(kstDateStr) {
  const day = parseInt(kstDateStr.slice(8, 10), 10);
  if (day <= 7)  return '1주차';
  if (day <= 14) return '2주차';
  if (day <= 21) return '3주차';
  if (day <= 28) return '4주차';
  return '5주차';
}

function renderWeeklyBreakdown(sessions) {
  _monthNavLevel = 1;
  const backBtn = document.getElementById('statDetailBack');
  backBtn.textContent = '‹ 뒤로';
  backBtn.onclick = () => switchTab('dashboard');
  document.getElementById('statDetailTitle').textContent = '이번 달 상담';
  document.getElementById('statDetailCount').textContent = `총 ${sessions.length}건`;

  const weekOrder  = ['1주차','2주차','3주차','4주차','5주차'];
  const weekRanges = { '1주차':'1~7일','2주차':'8~14일','3주차':'15~21일','4주차':'22~28일','5주차':'29일~' };
  const nowKST     = new Date(new Date().getTime() + KST);
  const month      = nowKST.getUTCMonth() + 1;

  const weekMap = {};
  sessions.forEach(s => {
    if (!s.started_at) return;
    const kd = new Date(new Date(s.started_at).getTime() + KST).toISOString().slice(0, 10);
    const wk = getWeekOfMonth(kd);
    if (!weekMap[wk]) weekMap[wk] = [];
    weekMap[wk].push(s);
  });

  const body = document.getElementById('statDetailBody');
  if (Object.keys(weekMap).length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:60px 0;color:#9ca3af;font-size:14px;">이번 달 상담 내역이 없습니다</div>';
    return;
  }

  body.innerHTML = weekOrder
    .filter(wk => weekMap[wk])
    .map(wk => {
      const cnt = weekMap[wk].length;
      return `
        <div onclick="openWeekDetail('${wk}')"
          style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-radius:12px;background:#f9fafb;border:1px solid #e5e7eb;margin-bottom:10px;cursor:pointer;transition:background .15s;"
          onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='#f9fafb'">
          <div>
            <div style="font-size:14px;font-weight:700;color:#111827;">${wk}</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:3px;">${month}월 ${weekRanges[wk]}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:15px;font-weight:700;color:#2563eb;">${cnt}건</span>
            <span style="color:#9ca3af;font-size:18px;">›</span>
          </div>
        </div>
      `;
    }).join('');
}

function openWeekDetail(weekLabel) {
  if (!_monthSessionsCache) return;
  _monthNavLevel = 2;

  const weekSessions = _monthSessionsCache.filter(s => {
    if (!s.started_at) return false;
    const kd = new Date(new Date(s.started_at).getTime() + KST).toISOString().slice(0, 10);
    return getWeekOfMonth(kd) === weekLabel;
  });

  const backBtn = document.getElementById('statDetailBack');
  backBtn.textContent = '‹ 이번 달';
  backBtn.onclick = () => renderWeeklyBreakdown(_monthSessionsCache);
  document.getElementById('statDetailTitle').textContent  = `이번 달 · ${weekLabel}`;
  document.getElementById('statDetailCount').textContent  = `총 ${weekSessions.length}건`;

  if (weekSessions.length === 0) {
    document.getElementById('statDetailBody').innerHTML =
      '<div style="text-align:center;padding:60px 0;color:#9ca3af;font-size:14px;">상담 내역이 없습니다</div>';
    return;
  }

  const DAY_KO = ['일','월','화','수','목','금','토'];
  const groups = {};
  weekSessions.forEach(s => {
    const kd = new Date(new Date(s.started_at).getTime() + KST).toISOString().slice(0, 10);
    if (!groups[kd]) groups[kd] = [];
    groups[kd].push(s);
  });

  document.getElementById('statDetailBody').innerHTML = Object.entries(groups).map(([date, list]) => {
    const dow  = DAY_KO[new Date(date + 'T00:00:00+09:00').getDay()];
    const mmdd = date.slice(5).replace('-', '/');
    const divider = `<div style="display:flex;align-items:center;gap:8px;margin:16px 0 10px;">
      <div style="flex:1;height:1px;background:#e5e7eb;"></div>
      <div style="font-size:12px;font-weight:600;color:#6b7280;white-space:nowrap;">${escAdmin(mmdd)}(${dow})</div>
      <div style="flex:1;height:1px;background:#e5e7eb;"></div>
    </div>`;
    const rows = list.map(s => `
      <div onclick="openHistoryDetail('${escAttr(String(s.id))}', ${s.is_test ? 1 : 0})"
        style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:#f9fafb;margin-bottom:8px;border:1px solid #f3f4f6;cursor:pointer;transition:background .15s;"
        onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='#f9fafb'">
        <div style="font-size:12px;color:#9ca3af;width:36px;flex-shrink:0;">${toKSTTime(s.started_at)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#111827;">${escAdmin(s.customer_name || '(이름 미수집)')}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">${escAdmin(s.phone || '연락처 없음')}${s.region ? ' · ' + escAdmin(s.region) : ''}${s.layout ? ' · ' + escAdmin(s.layout) : ''}</div>
        </div>
        <span style="font-size:16px;color:#9ca3af;flex-shrink:0;">›</span>
      </div>
    `).join('');
    return divider + rows;
  }).join('');
}

async function loadQuotes() {
  try {
    const res  = await fetch(`${SERVER}/api/quotes`, { headers: adminHeaders() });
    if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
    const data = await res.json();
    allQuotes = (data.quotes || []).slice().sort((a, b) => new Date(b.접수시간 || 0) - new Date(a.접수시간 || 0));

    // 새 견적 토스트 알림
    if (allQuotes.length > lastQuoteCount && lastQuoteCount > 0) {
      const diff = allQuotes.length - lastQuoteCount;
      showToast(`📬 새 견적 ${diff}건이 접수되었습니다!`, 'success');
    }
    lastQuoteCount = allQuotes.length;

    // 미확인 견적 배지 — 견적 탭이 열려 있으면 자동 확인
    const onQuotesTab = document.querySelector('.tab-btn.active')?.id === 'tab-quotes';
    if (onQuotesTab) {
      window.saveAdminSetting?.('lastSeenQuotesAt', new Date().toISOString());
      updateQuoteBadge(0);
    } else {
      const lastSeenQuotesAt = window.getAdminSetting?.('lastSeenQuotesAt');
      if (!lastSeenQuotesAt) {
        window.saveAdminSetting?.('lastSeenQuotesAt', new Date().toISOString());
        updateQuoteBadge(0);
      } else {
        const seenDate = new Date(lastSeenQuotesAt);
        const unread = allQuotes.filter(q => q.접수시간 && new Date(q.접수시간) > seenDate).length;
        updateQuoteBadge(unread);
      }
    }

    updateUI();
  } catch (e) {
    console.error('견적 로드 실패:', e);
  }
}

function loadDemoData() {
  allQuotes = [
    {
      id: 2,
      접수번호: 'KB-0002',
      접수시간: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      상태: '상담중', 담당자: '박상담',
      담당자배정일시: new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString(),
      메모: '오후 통화 예정', 특이사항: '', 후속연락필요: true, 시공완료일: null,
      접수경로: 'AI 루마네 채팅상담', 상담완료여부: true, 누락항목여부: false,
      대화요약: '분당 아파트 1자형 드레스룸. 아일랜드장 추가, 블랙 프레임 + 다크월넛 선반 선호.',
      상담이력개수: 1,
      마지막상담일시: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      상담이력: [
        {
          세션ID: 'KB-S-2026-0101-05',
          시작일시: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          종료일시: new Date(Date.now() - 24 * 60 * 60 * 1000 + 9 * 60000).toISOString(),
          재상담여부: false,
          요약: '분당 1자형 드레스룸 상담. 아일랜드장 추가, 블랙 프레임·다크월넛 선반으로 견적 접수.',
          마지막질문: '개인정보 수집에 동의하시겠어요?', 마지막답변: '동의합니다',
          메시지목록: [
            { role:'bot',  content:'안녕하세요! 성함을 알려주시겠어요?', time:'10:15' },
            { role:'user', content:'최준혁이에요', time:'10:15' },
            { role:'bot',  content:'연락처를 알려주세요.', time:'10:16' },
            { role:'user', content:'010-9876-5432', time:'10:16' },
            { role:'bot',  content:'설치 지역을 알려주세요.', time:'10:17' },
            { role:'user', content:'경기 분당이요', time:'10:17' },
            { role:'bot',  content:'공간 사이즈를 알려주세요.', time:'10:18' },
            { role:'user', content:'가로 2400, 세로 600, 높이 2200', time:'10:18' },
            { role:'bot',  content:'드레스룸 형태는요?', time:'10:19' },
            { role:'user', content:'1자형이요', time:'10:19' },
            { role:'bot',  content:'개인정보 수집에 동의하시겠어요?', time:'10:24' },
            { role:'user', content:'동의합니다', time:'10:24' },
            { role:'bot',  content:'감사합니다! 견적 접수 완료되었습니다.', time:'10:24' },
          ],
        },
      ],
      고객정보: {
        이름: '최준혁', 연락처: '010-9876-5432', 설치지역: '경기 분당',
        공간형태: '1자형', 공간사이즈: '가로 2400 × 세로 600 × 높이 2200 mm',
        추가옵션: ['아일랜드장'], 프레임색상: '블랙', 선반색상: '다크월넛',
        요청사항: '', 개인정보동의: '동의',
      },
    },
    {
      id: 3,
      접수번호: 'KB-0003',
      접수시간: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      상태: '접수완료', 담당자: null, 담당자배정일시: null,
      메모: '', 특이사항: '', 후속연락필요: false, 시공완료일: null,
      접수경로: 'AI 루마네 채팅상담', 상담완료여부: true, 누락항목여부: false,
      대화요약: '마포구 ㄷ자형 대형 드레스룸. 거울장·3단서랍장·악세사리장 풀옵션, 솔리드화이트 선반.',
      상담이력개수: 1,
      마지막상담일시: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      상담이력: [
        {
          세션ID: 'KB-S-2025-1229-03',
          시작일시: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          종료일시: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 11 * 60000).toISOString(),
          재상담여부: false,
          요약: '마포구 ㄷ자형 대형 드레스룸 상담. 풀옵션(거울장·3단서랍장·악세사리장), 실버 프레임·솔리드화이트 선반 선택.',
          마지막질문: '요청사항이 있으신가요?', 마지막답변: '옷 수납 위주로 설계 부탁드립니다',
          메시지목록: [
            { role:'bot',  content:'안녕하세요! 성함을 알려주시겠어요?', time:'09:40' },
            { role:'user', content:'박민지요', time:'09:40' },
            { role:'bot',  content:'연락처를 알려주세요.', time:'09:41' },
            { role:'user', content:'010-5555-7777', time:'09:41' },
            { role:'bot',  content:'설치 지역을 알려주세요.', time:'09:42' },
            { role:'user', content:'서울 마포구요', time:'09:42' },
            { role:'bot',  content:'공간 사이즈를 알려주세요.', time:'09:43' },
            { role:'user', content:'가로 4000, 세로 3000, 높이 2500', time:'09:43' },
            { role:'bot',  content:'드레스룸 형태는요?', time:'09:44' },
            { role:'user', content:'ㄷ자형이에요', time:'09:44' },
            { role:'bot',  content:'요청사항이 있으신가요?', time:'09:50' },
            { role:'user', content:'옷 수납 위주로 설계 부탁드립니다', time:'09:51' },
            { role:'bot',  content:'감사합니다! 견적 접수가 완료되었습니다. 😊', time:'09:51' },
          ],
        },
      ],
      고객정보: {
        이름: '박민지', 연락처: '010-5555-7777', 설치지역: '서울 마포구',
        공간형태: 'ㄷ자형', 공간사이즈: '가로 4000 × 세로 3000 × 높이 2500 mm',
        추가옵션: ['거울장', '3단서랍장', '악세사리장'], 프레임색상: '실버', 선반색상: '솔리드화이트',
        요청사항: '옷 수납 위주로 설계 부탁드립니다', 개인정보동의: '동의',
      },
    },
    {
      id: 4,
      접수번호: 'KB-0004',
      접수시간: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      상태: '시공완료', 담당자: '김디자인',
      담당자배정일시: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
      메모: '고객 만족도 높음. 지인 소개 예정', 특이사항: '2회 방문 현장 확인 후 설계 확정',
      후속연락필요: false,
      시공완료일: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      접수경로: 'AI 루마네 채팅상담', 상담완료여부: true, 누락항목여부: false,
      대화요약: '연수구 11자형 대형 드레스룸. 골드 프레임, 스톤그레이 선반. 시공 완료 후 만족도 우수.',
      상담이력개수: 1,
      마지막상담일시: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      상담이력: [
        {
          세션ID: 'KB-S-2025-1224-04',
          시작일시: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          종료일시: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 10 * 60000).toISOString(),
          재상담여부: false,
          요약: '연수구 11자형 대형 드레스룸 상담. 5000mm 공간, 골드 프레임·스톤그레이 선반, 2단서랍장 옵션으로 견적 접수.',
          마지막질문: '개인정보 수집에 동의하시겠어요?', 마지막답변: '동의합니다',
          메시지목록: [
            { role:'bot',  content:'안녕하세요! 성함을 알려주시겠어요?', time:'16:20' },
            { role:'user', content:'정수진이에요', time:'16:20' },
            { role:'bot',  content:'연락처를 알려주세요.', time:'16:21' },
            { role:'user', content:'010-3333-8888', time:'16:21' },
            { role:'bot',  content:'설치 지역을 알려주세요.', time:'16:22' },
            { role:'user', content:'인천 연수구요', time:'16:22' },
            { role:'bot',  content:'공간 사이즈를 알려주세요.', time:'16:23' },
            { role:'user', content:'가로 5000, 세로 600, 높이 2400', time:'16:23' },
            { role:'bot',  content:'드레스룸 형태는요?', time:'16:24' },
            { role:'user', content:'11자형이요', time:'16:24' },
            { role:'bot',  content:'개인정보 수집에 동의하시겠어요?', time:'16:30' },
            { role:'user', content:'동의합니다', time:'16:30' },
            { role:'bot',  content:'감사합니다! 견적 접수가 완료되었습니다. 😊', time:'16:30' },
          ],
        },
      ],
      고객정보: {
        이름: '정수진', 연락처: '010-3333-8888', 설치지역: '인천 연수구',
        공간형태: '11자형', 공간사이즈: '가로 5000 × 세로 600 × 높이 2400 mm',
        추가옵션: ['2단서랍장'], 프레임색상: '골드', 선반색상: '스톤그레이',
        요청사항: '', 개인정보동의: '동의',
      },
    },
  ];

  lastQuoteCount = allQuotes.length;
  updateUI();
  showToast('⚠️ 서버 오프라인 · 데모 데이터 표시 중', 'default');
}

function refreshData() {
  checkServer();
  showToast('🔄 데이터를 새로 불러옵니다...');
}


/* ================================================================
   UI 업데이트 함수들
================================================================ */

function updateUI() {
  updateDashboard();
  updateQuoteList();
  updateManagerFilter();
}

function updateDashboard() {
  // 대시보드가 세션 목록으로 교체됨 — 구 stat 요소 없으면 스킵
  if (!document.getElementById('statTotal')) return;

  const total = allQuotes.length;
  const cnt = { '접수완료': 0, '상담중': 0, '설계중': 0, '시공완료': 0 };
  allQuotes.forEach(q => { if (cnt[q.상태] !== undefined) cnt[q.상태]++; });

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('statActive',  cnt['접수완료'] + cnt['상담중']);
  setText('statDesign',  cnt['설계중']);
  setText('statDone',    cnt['시공완료']);
  setText('statDoneRate', total > 0 ? `전환율 ${Math.round(cnt['시공완료'] / total * 100)}%` : '전환율 0%');
  setText('leg0', cnt['접수완료']);
  setText('leg1', cnt['상담중']);
  setText('leg2', cnt['설계중']);
  setText('leg3', cnt['시공완료']);

  const bar = document.getElementById('pipelineBar');
  if (bar) {
    bar.innerHTML = total === 0
      ? '<div class="pipeline-seg 접수완료" style="flex:1">견적 없음</div>'
      : ['접수완료', '상담중', '설계중', '시공완료']
          .filter(s => cnt[s] > 0)
          .map(s => `<div class="pipeline-seg ${s}" style="flex:${cnt[s]}">${cnt[s]}건</div>`)
          .join('');
  }

  const recentList = document.getElementById('recentList');
  if (!recentList) return;
  const recent = [...allQuotes].reverse().slice(0, 5);
  recentList.innerHTML = recent.length === 0
    ? `<div class="empty-state"><div class="emoji">📭</div><p>아직 접수된 견적이 없습니다</p></div>`
    : recent.map(q => `
        <div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6;cursor:pointer;gap:14px;" onclick="openModal('${escAttr(String(q.id))}')">
          <span style="font-size:13px;font-weight:700;color:#7c3aed;min-width:80px">${q.접수번호}</span>
          <span style="font-size:14px;font-weight:600;min-width:80px">${q.고객정보?.이름 || '-'}</span>
          <span style="font-size:13px;color:#6b7280;flex:1">${q.고객정보?.설치지역 || '-'}</span>
          <span class="status-badge ${q.상태}">${q.상태}</span>
          <span style="font-size:12px;color:#9ca3af">${formatDate(q.접수시간)}</span>
        </div>`).join('');
}

function updateQuoteList(quotes) {
  const list      = quotes || allQuotes;
  const container = document.getElementById('quoteList');
  document.getElementById('quotesCount').textContent = `총 ${list.length}건`;

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="emoji">🔍</div><p>조건에 맞는 견적이 없습니다</p></div>`;
    return;
  }

  container.innerHTML = [...list].reverse().map(q => {
    const isAI = q.출처 === 'AI상담';
    const sourceBadge = isAI
      ? `<span style="background:#ede9fe;color:#7c3aed;font-size:11px;padding:2px 7px;border-radius:10px;font-weight:600;">🤖 AI상담</span>`
      : `<span style="background:#f0fdf4;color:#16a34a;font-size:11px;padding:2px 7px;border-radius:10px;font-weight:600;">📝 직접입력</span>`;
    return `
    <div class="quote-card" onclick="openModal('${escAttr(String(q.id))}')">
      <div class="quote-card-header">
        <div class="quote-no">${q.접수번호}</div>
        <div class="quote-name">${q.고객정보?.이름 || '-'}</div>
        <div class="quote-phone">${q.고객정보?.연락처 || '-'}</div>
        <div class="quote-region">${q.고객정보?.설치지역 || '-'}</div>
        <div class="quote-date">${formatDate(q.접수시간)}</div>
        <div class="quote-manager">${q.담당자 || '<span style="color:#d1d5db">미배정</span>'}</div>
        ${sourceBadge}
        <span class="status-badge ${q.상태}">${q.상태}</span>
      </div>
    </div>
  `;
  }).join('');
}

function updateManagerFilter() {
  const managers = [...new Set(allQuotes.map(q => q.담당자).filter(Boolean))];
  const sel = document.getElementById('managerFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">전체 담당자</option>' +
    managers.map(m => `<option value="${escAttr(m)}">${escAdmin(m)}</option>`).join('');
  sel.value = cur;
}


/* ================================================================
   미확인 상담 배지 업데이트
================================================================ */

function updateQuoteBadge(count) {
  const sideEl = document.getElementById('newBadge');
  const tabEl  = document.getElementById('quoteTabBadge');
  if (count > 0) {
    const label = count > 99 ? '99+' : String(count);
    if (sideEl) { sideEl.textContent = label; sideEl.style.display = 'inline'; }
    if (tabEl)  { tabEl.textContent  = label; tabEl.style.display  = 'inline'; }
  } else {
    if (sideEl) sideEl.style.display = 'none';
    if (tabEl)  tabEl.style.display  = 'none';
  }
}

function updateHistoryBadge(count) {
  const sideEl = document.getElementById('historyBadge');
  const tabEl  = document.getElementById('historyTabBadge');
  if (count > 0) {
    const label = count > 99 ? '99+' : String(count);
    if (sideEl) { sideEl.textContent = label; sideEl.style.display = 'inline'; }
    if (tabEl)  { tabEl.textContent  = label; tabEl.style.display  = 'inline'; }
  } else {
    if (sideEl) sideEl.style.display = 'none';
    if (tabEl)  tabEl.style.display  = 'none';
  }
}

/* ================================================================
   필터링 & 검색
================================================================ */

function filterQuotes() {
  const keyword       = document.getElementById('searchInput').value.toLowerCase();
  const statusFilter  = document.getElementById('statusFilter').value;
  const managerFilter = document.getElementById('managerFilter').value;

  const result = allQuotes.filter(q => {
    if (statusFilter  && q.상태    !== statusFilter)  return false;
    if (managerFilter && q.담당자  !== managerFilter) return false;
    if (keyword) {
      const target = [
        q.고객정보?.이름 || '',
        q.고객정보?.연락처 || '',
        q.고객정보?.설치지역 || '',
      ].join(' ').toLowerCase();
      if (!target.includes(keyword)) return false;
    }
    return true;
  });

  filteredQuotes = result;
  updateQuoteList(result);
}


/* ================================================================
   탭 전환
================================================================ */

function switchTab(tab) {
  if (tab !== 'live') stopLivePolling();

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(`tab-${tab}`).classList.add('active');
  document.getElementById(`section-${tab}`).classList.add('active');

  const navItems = document.querySelectorAll('.nav-item');
  if (tab === 'dashboard') {
    navItems[0].classList.add('active');
    document.getElementById('topbarTitle').textContent = '📊 대시보드';
    window.saveAdminSetting?.('lastSeenHistoryAt', new Date().toISOString());
    if (typeof updateHistoryBadge === 'function') updateHistoryBadge(0);
    // 대시보드 진입 시 즉시 세션 목록 + 유입 소스 로드
    fetchLiveSessions();
    if (typeof loadSourceStats === 'function') loadSourceStats('today');
  } else if (tab === 'quotes') {
    navItems[1].classList.add('active');
    document.getElementById('topbarTitle').textContent = '📋 견적 목록';
    window.saveAdminSetting?.('lastSeenQuotesAt', new Date().toISOString());
    updateQuoteBadge(0);
  } else if (tab === 'live') {
    navItems[2].classList.add('active');
    document.getElementById('topbarTitle').textContent = '📡 라이브 상담';
    startLivePolling();
  } else if (tab === 'tokens') {
    document.getElementById('topbarTitle').textContent = '🪙 토큰 사용량';
    loadTokenStats();
  } else if (tab === 'visitor-stats') {
    document.getElementById('topbarTitle').textContent = '📈 방문자 통계';
    if (typeof loadVisitorStats === 'function') loadVisitorStats(window.currentVsRange || 7);
  } else if (tab === 'trash') {
    document.getElementById('topbarTitle').textContent = '🗑 휴지통';
    if (typeof loadTrash === 'function') loadTrash();
  } else if (tab === 'stat-detail') {
    document.getElementById('topbarTitle').textContent = '📊 상담 현황';
  } else if (tab === 'backup') {
    document.getElementById('topbarTitle').textContent = '📦 백업';
    if (window.lumaneBackup && typeof lumaneBackup.renderBackupTab === 'function') {
      lumaneBackup.renderBackupTab();
    }
  } else if (tab === 'history') {
    document.getElementById('topbarTitle').textContent = '🗂️ 저장된 상담';
    updateHistoryBadge(0);
    const loadStartedAt = new Date().toISOString();
    loadHistory().then(() => {
      if (document.querySelector('.tab-btn.active')?.id === 'tab-history') {
        window.saveAdminSetting?.('lastSeenHistoryAt', loadStartedAt);
      }
    });
  }
}

let _tokenPeriod = 'all';

function setTokenPeriod(period) {
  _tokenPeriod = period;
  ['day','week','month','all'].forEach(p => {
    const btn = document.getElementById(`tk-tab-${p}`);
    if (!btn) return;
    const active = p === period;
    btn.style.background = active ? '#7c3aed' : '#fff';
    btn.style.color = active ? '#fff' : '';
    btn.style.borderColor = active ? '#7c3aed' : '#e5e7eb';
    btn.style.fontWeight = active ? '600' : '';
  });
  loadTokenStats();
}

async function loadTokenStats() {
  const errEl = document.getElementById('tk-error');
  errEl.style.display = 'none';
  try {
    const res = await fetch(`${SERVER}/api/admin/token-stats?period=${_tokenPeriod}`, { headers: adminHeaders() });
    const d = await res.json();
    if (!res.ok) {
      errEl.textContent = `오류: ${d.error || res.status}`;
      errEl.style.display = 'block';
      return;
    }

    document.getElementById('tk-cost-krw').textContent = `₩${d.costKRW.toLocaleString()}`;
    document.getElementById('tk-cost-usd').textContent  = `$${d.costUSD}`;
    document.getElementById('tk-saved-krw').textContent = `₩${d.savedKRW.toLocaleString()} 절감`;
    document.getElementById('tk-saved-usd').textContent = `$${d.savedUSD} 절감`;
    document.getElementById('tk-input').textContent     = (d.total.input + d.total.cacheRead).toLocaleString();
    document.getElementById('tk-output').textContent    = d.total.output.toLocaleString();
    document.getElementById('tk-sessions').textContent  = `${d.sessionCount}개 세션`;

    if (d.sessionCount > 0) {
      const avgCostKRW = Math.round(d.costKRW / d.sessionCount);
      const avgTokens  = Math.round((d.total.input + d.total.cacheRead + d.total.output) / d.sessionCount);
      document.getElementById('tk-avg-cost').textContent   = `₩${avgCostKRW.toLocaleString()}`;
      document.getElementById('tk-avg-tokens').textContent = `평균 ${avgTokens.toLocaleString()} 토큰`;
    } else {
      document.getElementById('tk-avg-cost').textContent   = '₩0';
      document.getElementById('tk-avg-tokens').textContent = '데이터 없음';
    }

    // 바 차트
    const byDate = d.byDate || {};
    const dates  = Object.keys(byDate).sort();
    const chartEl  = document.getElementById('tk-chart');
    const labelEl  = document.getElementById('tk-chart-labels');
    if (dates.length === 0) {
      chartEl.innerHTML = `<div style="color:#9ca3af;font-size:12px;line-height:100px;">데이터 없음</div>`;
      labelEl.innerHTML = '';
    } else {
      const maxCost = Math.max(...dates.map(d => byDate[d].costKRW), 1);
      chartEl.innerHTML = dates.map(date => {
        const pct  = Math.max(4, Math.round((byDate[date].costKRW / maxCost) * 100));
        const info = byDate[date];
        const tip  = encodeURIComponent(JSON.stringify({ date, costKRW: info.costKRW, input: info.input, output: info.output, sessions: info.sessions }));
        return `<div
          data-tip="${tip}"
          style="flex:1;min-width:28px;max-width:48px;height:${pct}%;background:#7c3aed;border-radius:4px 4px 0 0;cursor:default;transition:opacity .15s;"
          onmouseenter="showTkTooltip(event,this)" onmouseleave="hideTkTooltip()" onmousemove="moveTkTooltip(event)"></div>`;
      }).join('');
      labelEl.innerHTML = dates.map(date =>
        `<div style="flex:1;min-width:28px;max-width:48px;font-size:10px;color:#9ca3af;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${date.slice(5)}</div>`
      ).join('');
    }

    // 세션 테이블
    const tbody = document.getElementById('tk-session-rows');
    if (!d.perSession || d.perSession.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:#9ca3af;">데이터 없음</td></tr>`;
    } else {
      tbody.innerHTML = d.perSession.map(s => `
        <tr style="border-top:1px solid #f3f4f6;">
          <td style="padding:9px 14px;color:#9ca3af;">${s.date || '-'}</td>
          <td style="padding:9px 14px;">${s.customerName}</td>
          <td style="padding:9px 14px;text-align:right;">${s.input.toLocaleString()}</td>
          <td style="padding:9px 14px;text-align:right;">${s.output.toLocaleString()}</td>
          <td style="padding:9px 14px;text-align:right;">${s.cacheRead.toLocaleString()}</td>
          <td style="padding:9px 14px;text-align:right;">${s.turns}</td>
        </tr>`).join('');
    }
  } catch (err) {
    errEl.textContent = `네트워크 오류: ${err.message}`;
    errEl.style.display = 'block';
  }
}


/* ================================================================
   저장된 상담 탭
================================================================ */
let _historyAll = [];

async function loadHistory() {
  const listEl = document.getElementById('historyList');
  const errEl  = document.getElementById('historyError');
  errEl.style.display = 'none';
  listEl.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:32px;font-size:13px;">불러오는 중…</div>';
  try {
    const res = await fetch(`${SERVER}/api/admin/conversations`, { headers: adminHeaders() });
    if (!res.ok) {
      let detail = '';
      try { const d = await res.json(); detail = d.error || ''; } catch(_) {}
      throw new Error(`서버 오류 ${res.status}${detail ? ': ' + detail : ''}`);
    }
    const data = await res.json();
    _historyAll = data.conversations || [];
    filterHistory();
  } catch (err) {
    errEl.textContent = `불러오기 실패: ${err.message}`;
    errEl.style.display = 'block';
    listEl.innerHTML = '';
  }
}

function filterHistory() {
  const kw     = (document.getElementById('historySearch')?.value || '').trim().toLowerCase();
  const reason = document.getElementById('historyReasonFilter')?.value || '';
  const date   = document.getElementById('historyDateFilter')?.value || '';
  const result = _historyAll.filter(c => {
    if (reason && c.save_reason !== reason) return false;
    if (date) {
      const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const savedKST = c.saved_at
        ? new Date(new Date(c.saved_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : null;
      if (savedKST !== date) return false;
    }
    if (!kw) return true;
    return [c.customer_name, c.phone, c.region, c.layout].some(v => (v || '').toLowerCase().includes(kw));
  });
  renderHistoryList(result);
}

function renderHistoryList(list) {
  const listEl = document.getElementById('historyList');
  if (!list.length) {
    listEl.innerHTML = '<div style="text-align:center;color:#d1d5db;padding:40px;font-size:13px;">저장된 상담이 없습니다</div>';
    return;
  }
  const fmt = n => n ? Number(n).toLocaleString('ko-KR') + '원' : '-';
  const badge = r => r === 'manual'
    ? '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#ede9fe;color:#7c3aed;font-weight:600;">수동</span>'
    : '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#f0fdf4;color:#16a34a;font-weight:600;">자동</span>';

  const _seenSet = window._getSeenSessions?.() || new Set();

  listEl.innerHTML = list.map(c => {
    const isNew = c.id && !_seenSet.has(c.id);
    const borderColor = isNew ? '#ef4444' : '#3b82f6';
    const savedAt = c.saved_at ? new Date(c.saved_at).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-';
    const summaryObj = parseSummary(c);
    const summaryText = summaryObj?.상담요약 || '';
    return `
    <div style="background:#fff;border:1px solid #e5e7eb;border-left:4px solid ${borderColor};border-radius:12px;padding:14px 18px;transition:box-shadow .15s;display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center;"
      onmouseover="this.style.boxShadow='0 2px 12px rgba(0,0,0,.08)'"
      onmouseout="this.style.boxShadow='none'">
      <div onclick="if(window.markSessionSeen)markSessionSeen('${escAttr(c.id)}');openHistoryDetail('${escAttr(c.id)}', ${c.is_test ? 1 : 0})" style="cursor:pointer;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:15px;font-weight:700;">${escAdmin(getConvLabel(c))}</span>
          ${badge(c.save_reason)}
          ${isNew ? '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#ef4444;color:#fff;font-weight:700;">NEW</span>' : ''}
        </div>
        <div style="font-size:12.5px;color:#6b7280;display:flex;gap:14px;flex-wrap:wrap;${summaryText ? 'margin-bottom:6px;' : ''}">
          <span>📞 ${escAdmin(c.phone || '-')}</span>
          <span>📍 ${escAdmin(c.region || '-')}</span>
          <span>🪞 ${escAdmin(c.layout || '-')}</span>
          <span>💬 ${c.message_count || 0}개</span>
        </div>
        ${summaryText ? `<div style="font-size:12px;color:#374151;line-height:1.5;border-left:3px solid #e5e7eb;padding-left:8px;">${escAdmin(summaryText)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;color:#c9a96e;">${fmt(c.estimated_price)}</div>
        <div style="font-size:11px;color:#9ca3af;">${savedAt}</div>
        <button onclick="deleteConversationById('${escAttr(c.id)}', ${c.is_test ? 1 : 0})"
          style="background:#ef4444;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;white-space:nowrap;">🗑 삭제</button>
      </div>
    </div>`;
  }).join('');
}

let _currentHistoryId = null;
let _currentHdSessionId = null;
let _currentHistoryIsTest = false;

async function openHistoryDetail(id, isTest) {
  _currentHistoryId = id;
  _currentHistoryIsTest = !!isTest;
  _currentHdSessionId = null;
  const overlay = document.getElementById('historyDetailOverlay');
  overlay.style.display = 'flex';
  document.getElementById('hdTitle').textContent = '불러오는 중…';
  document.getElementById('hdMeta').textContent = '';
  document.getElementById('hdSummary').innerHTML = '';
  document.getElementById('hdMsgs').innerHTML = '';
  document.getElementById('hdReplyInput').value = '';
  document.getElementById('hdReplyArea').style.display = 'none';
  // 어드민 메모 로드 (백그라운드)
  if (typeof window.hdLoadMemos === 'function') window.hdLoadMemos(id);
  try {
    const qs = _currentHistoryIsTest ? '?test=1' : '';
    const res = await fetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(id)}${qs}`, { headers: adminHeaders() });
    if (!res.ok) throw new Error();
    const { conversation: c } = await res.json();
    if (c.session_id) {
      _currentHdSessionId = c.session_id;
      document.getElementById('hdReplyArea').style.display = 'flex';
    }
    const savedAt = c.saved_at ? new Date(c.saved_at).toLocaleString('ko-KR') : '-';
    document.getElementById('hdTitle').textContent = getConvLabel(c);
    document.getElementById('hdMeta').textContent  = `저장: ${savedAt} · ${c.message_count || 0}개 메시지`;
    const fmt = n => n ? Number(n).toLocaleString('ko-KR') + '원' : '-';
    const summaryObj = parseSummary(c);
    const 구성내용 = summaryObj?.내용 || '';
    document.getElementById('hdSummary').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;">
        ${[['연락처', c.phone], ['설치지역', c.region], ['공간사이즈', c.size_raw], ['드레스룸형태', c.layout],
           ['추가옵션', c.options_text], ['프레임색상', c.frame_color], ['선반색상', c.shelf_color], ['요청사항', c.memo]]
          .map(([l, v]) => v ? `<div><span style="color:#9ca3af;font-size:11px;">${l} </span><span>${escAdmin(v)}</span></div>` : '').join('')}
      </div>
      ${구성내용 ? `<div style="margin-top:8px;"><span style="color:#9ca3af;font-size:11px;">예상 구성 </span><span style="font-size:12.5px;line-height:1.6;">${escAdmin(구성내용)}</span></div>` : ''}
      ${c.estimated_price ? `<div style="margin-top:8px;font-weight:700;color:#c9a96e;">예상 단가: ${fmt(c.estimated_price)}</div>` : ''}`;
    const msgs = c.messages || [];
    document.getElementById('hdMsgs').innerHTML = msgs.map(m => {
      const isUser = m.role === 'user';
      const bg = isUser ? '#7c3aed' : '#fff';
      const color = isUser ? '#fff' : '#1a1a2e';
      const align = isUser ? 'flex-end' : 'flex-start';
      const label = isUser ? '' : `<div style="font-size:11px;font-weight:700;margin-bottom:3px;color:#6b7280;">${m.fromAdmin ? '담당자' : '루마네'}</div>`;
      return `<div style="display:flex;justify-content:${align};">
        <div style="max-width:75%;">${label}
          <div style="padding:9px 13px;border-radius:12px;background:${bg};color:${color};font-size:13.5px;line-height:1.6;word-break:break-word;white-space:pre-wrap;">${escAdmin(m.content || '')}</div>
        </div>
      </div>`;
    }).join('');
  } catch {
    document.getElementById('hdTitle').textContent = '불러오기 실패';
  }
}

async function sendHdReply() {
  const input = document.getElementById('hdReplyInput');
  const msg = input.value.trim();
  if (!msg || !_currentHdSessionId) return;
  const btn = document.getElementById('hdSendBtn');
  btn.disabled = true;
  btn.textContent = '전송 중…';
  try {
    const takeoverRes = await fetch(`${SERVER}/api/admin/takeover`, {
      method: 'POST', headers: adminHeaders(),
      body: JSON.stringify({ sessionId: _currentHdSessionId }),
    });
    if (!takeoverRes.ok) {
      let errMsg = '이어하기 전환 실패';
      try { errMsg = (await takeoverRes.json()).error || errMsg; } catch {}
      throw new Error(errMsg);
    }
    const res = await fetch(`${SERVER}/api/admin/message`, {
      method: 'POST', headers: adminHeaders(),
      body: JSON.stringify({ sessionId: _currentHdSessionId, message: msg }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    input.value = '';
    const hdMsgs = document.getElementById('hdMsgs');
    hdMsgs.insertAdjacentHTML('beforeend', `
      <div style="display:flex;justify-content:flex-end;">
        <div style="max-width:75%;">
          <div style="padding:9px 13px;border-radius:12px;background:#7c3aed;color:#fff;font-size:13.5px;line-height:1.6;word-break:break-word;white-space:pre-wrap;">${escAdmin(msg)}</div>
        </div>
      </div>`);
    hdMsgs.scrollTop = hdMsgs.scrollHeight;
  } catch (err) {
    showToast(`전송 실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '전송';
  }
}

function closeHistoryDetail(e) {
  if (e && e.target !== document.getElementById('historyDetailOverlay')) return;
  document.getElementById('historyDetailOverlay').style.display = 'none';
  _currentHistoryId = null;
  _currentHdSessionId = null;
  _currentHistoryIsTest = false;
}

async function deleteConversationById(id, isTest) {
  if (!confirm('이 상담 기록을 삭제하시겠습니까? 복구할 수 없습니다.')) return;
  try {
    const qs = isTest ? '?test=1' : '';
    const res = await fetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(id)}${qs}`, {
      method: 'DELETE', headers: adminHeaders(),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || res.status); }
    showToast('상담 기록이 삭제됐습니다.', 'success');
    loadHistory();
  } catch (err) {
    showToast(`삭제 실패: ${err.message}`, 'error');
  }
}

async function deleteConversation() {
  if (!_currentHistoryId) return;
  if (!confirm('이 상담 기록을 삭제하시겠습니까? 복구할 수 없습니다.')) return;
  const btn = document.getElementById('hdDeleteBtn');
  btn.textContent = '삭제 중…';
  btn.disabled = true;
  try {
    const qs = _currentHistoryIsTest ? '?test=1' : '';
    const res = await fetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(_currentHistoryId)}${qs}`, {
      method: 'DELETE', headers: adminHeaders(),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || res.status); }
    showToast('상담 기록이 삭제됐습니다.', 'success');
    document.getElementById('historyDetailOverlay').style.display = 'none';
    loadHistory();
  } catch (err) {
    btn.textContent = '🗑 삭제';
    btn.disabled = false;
    showToast(`삭제 실패: ${err.message}`, 'error');
  }
}

async function registerQuoteFromConversation() {
  if (!_currentHistoryId) return;
  const btn = document.getElementById('hdRegisterQuoteBtn');
  btn.textContent = '등록 중…';
  btn.disabled = true;
  try {
    const qs = _currentHistoryIsTest ? '?test=1' : '';
    const res = await fetch(`${SERVER}/api/admin/conversations/${encodeURIComponent(_currentHistoryId)}/register-quote${qs}`, {
      method: 'POST', headers: adminHeaders(),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || res.status); }
    btn.textContent = '✅ 등록 완료';
    showToast('견적 목록에 등록됐습니다!', 'success');
    loadQuotes();
  } catch (err) {
    btn.textContent = '❌ 실패';
    showToast(`등록 실패: ${err.message}`, 'error');
  } finally {
    setTimeout(() => { btn.textContent = '📋 견적접수 등록'; btn.disabled = false; }, 3000);
  }
}

/* ================================================================
   차트 툴팁
================================================================ */

function _escTip(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showTkTooltip(e, el) {
  const tip = JSON.parse(decodeURIComponent(el.dataset.tip));
  const tt  = document.getElementById('tk-tooltip');
  tt.innerHTML =
    `<div style="font-weight:700;margin-bottom:2px;">${_escTip(tip.date)}</div>` +
    `<div>💰 ₩${_escTip(tip.costKRW.toLocaleString())}</div>` +
    `<div>📥 입력 ${_escTip(tip.input.toLocaleString())} 토큰</div>` +
    `<div>📤 출력 ${_escTip(tip.output.toLocaleString())} 토큰</div>` +
    `<div>💬 ${_escTip(tip.sessions)}개 세션</div>`;
  tt.style.display = 'block';
  moveTkTooltip(e);
}

function moveTkTooltip(e) {
  const tt = document.getElementById('tk-tooltip');
  const x  = e.clientX + 14;
  const y  = e.clientY - tt.offsetHeight - 8;
  tt.style.left = Math.min(x, window.innerWidth - tt.offsetWidth - 8) + 'px';
  tt.style.top  = Math.max(y, 8) + 'px';
}

function hideTkTooltip() {
  document.getElementById('tk-tooltip').style.display = 'none';
}

/* ================================================================
   앱 초기화
================================================================ */

checkServer().then(() => startBgPolling());
setInterval(checkServer, 30000);
initAdminFileUpload();
initAdminPaste();
initAdminCtxMenuListener();
initAdminSearch();
window.toggleAdminSearch    = toggleAdminSearch;
window.clearAdminReplyBar   = clearAdminReplyBar;

/* 모바일 사이드바 토글 */
window.toggleSidebar = function() {
  const sidebar  = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const isOpen   = sidebar.classList.toggle('open');
  backdrop.classList.toggle('open', isOpen);
};

/* 탭 전환 시 모바일 사이드바 자동 닫기 (nav-item 클릭 이벤트) */
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    const sidebar  = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
  });
});
window.toggleTemplatePanel  = toggleTemplatePanel;
window.openTemplateEditor   = openTemplateEditor;
window.closeTemplateEditor  = closeTemplateEditor;
window.addTemplateItem      = addTemplateItem;
window.removeTemplateItem   = removeTemplateItem;
window.saveTemplates        = saveTemplates;
window.applyTemplate        = applyTemplate;
window.sendHdReply          = sendHdReply;

/* 배포 자동감지 — 새 버전 배포 시 자동 새로고침 */
(async function startUpdateChecker() {
  let currentVersion = null;
  try {
    const r = await fetch(`${SERVER}/api/version`);
    if (r.ok) currentVersion = (await r.json()).v;
  } catch { /* 무시 */ }

  setInterval(async () => {
    if (!serverOnline) return;
    try {
      const r = await fetch(`${SERVER}/api/version?t=${Date.now()}`);
      if (!r.ok) return;
      const { v } = await r.json();
      if (currentVersion && v !== currentVersion) {
        location.reload(true);
      }
    } catch { /* 무시 */ }
  }, 30000);
})();

/* ================================================================
   브라우저 알림 (상담원용)
================================================================ */
(function initAdminNotifications() {
  if (!('Notification' in window)) return;

  // 권한 요청 (아직 결정 안 됐을 때만)
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
})();

let _notifiedSessions = new Set();
let _notifiedMsgCounts = {};

function notifyNewSession(sess) {
  if (Notification.permission !== 'granted') return;
  new Notification('💬 새 상담 연결', {
    body: `${sess.customerName || '고객'}님이 상담을 시작했습니다`,
    icon: '/favicon.ico',
  });
}

function notifyNewMessage(sess) {
  if (Notification.permission !== 'granted') return;
  new Notification('📩 새 메시지', {
    body: `${sess.customerName || '고객'}: 새 메시지가 도착했습니다`,
    icon: '/favicon.ico',
  });
}

// fetchLiveSessions 결과를 후킹해서 새 세션/메시지 알림
const _origFetchLiveSessions = fetchLiveSessions;
window._checkNotifications = function(sessions) {
  sessions.forEach(sess => {
    // 새 세션 알림
    if (!_notifiedSessions.has(sess.id)) {
      _notifiedSessions.add(sess.id);
      if (_notifiedSessions.size > 1) notifyNewSession(sess); // 첫 로드 제외
    }
    // 새 메시지 알림
    const prev = _notifiedMsgCounts[sess.id] ?? sess.messageCount;
    if (sess.messageCount > prev) notifyNewMessage(sess);
    _notifiedMsgCounts[sess.id] = sess.messageCount;
  });
};

/* ================================================================
   도움말 모달
================================================================ */
const HELP_CONTENT = {
  dashboard: {
    label: '📊 대시보드',
    items: [
      { icon: '📊', title: '상담 통계 카드', desc: '오늘·이번 주·이번 달·누적 상담 수를 볼 수 있어요. 숫자를 클릭하면 해당 기간 상담 목록이 펼쳐져요.' },
      { icon: '🟢', title: '실시간 상담', desc: '지금 루마네와 대화 중인 고객이 표시돼요. NEW 뱃지가 달린 건 아직 확인 안 한 새 상담이에요. 클릭하면 대화 내용을 볼 수 있어요.' },
      { icon: '🗂️', title: '최근 저장된 상담', desc: '가장 최근에 끝난 상담이 표시돼요. 클릭하면 이름·지역·견적금액 상세 내용으로 이동해요.' },
    ],
  },
  quotes: {
    label: '📋 견적 목록',
    items: [
      { icon: '🔍', title: '검색 · 필터', desc: '이름·연락처·지역으로 빠르게 검색할 수 있어요. 상태 필터로 진행 중 / 완료를 구분해서 볼 수도 있어요.' },
      { icon: '📋', title: '견적 목록', desc: 'AI 상담에서 견적 등록된 고객이 여기에 쌓여요. 클릭하면 치수·옵션·대화 내용을 모두 볼 수 있어요.' },
      { icon: '➕', title: '수동 등록', desc: '전화나 방문으로 들어온 견적을 직접 입력할 수 있어요.' },
    ],
  },
  live: {
    label: '💬 대화',
    items: [
      { icon: '💬', title: '모든 대화 목록', desc: '진행 중인 대화(🤖 AI 중)와 완료된 대화(📁)가 하나의 목록에 표시돼요. 클릭하면 오른쪽에 대화 내용이 펼쳐져요.' },
      { icon: '🟢', title: '진행 중 표시', desc: '초록 점이 있으면 지금 고객이 채팅창을 열고 대화 중이에요. 실시간으로 내용이 업데이트돼요.' },
      { icon: '📁', title: '완료된 대화', desc: '고객이 채팅을 마친 후 자동으로 저장된 대화예요. 클릭하면 전체 내용을 볼 수 있고, 상세보기로 견적 등록도 가능해요.' },
      { icon: '👩‍💼', title: '난입하기 버튼', desc: '진행 중인 대화에서 AI 대신 담당자가 직접 답변할 수 있어요. 민감한 상담이나 견적 확정 시 사용하세요.' },
    ],
  },
  tokens: {
    label: '🪙 토큰 사용량',
    items: [
      { icon: '🪙', title: '토큰 사용량', desc: 'AI 루마네가 대화에서 사용한 토큰(AI 비용)을 날짜별로 볼 수 있어요.' },
      { icon: '💰', title: '비용 확인', desc: '일별·주별·월별로 AI 사용 비용을 한눈에 파악할 수 있어요.' },
    ],
  },
  history: {
    label: '🗂️ 저장된 상담',
    items: [
      { icon: '🔍', title: '검색 · 날짜 필터', desc: '이름·연락처·지역으로 검색하거나 날짜를 지정해서 특정 날 상담만 볼 수 있어요.' },
      { icon: '🗂️', title: '저장된 상담 목록', desc: 'AI가 자동으로 저장한 상담 기록이에요. 클릭하면 전체 대화 내용과 수집된 정보를 볼 수 있어요.' },
      { icon: '📋', title: '견적 등록 버튼', desc: '상담 내용을 견적 목록 탭으로 옮길 수 있어요. AI가 이름·연락처·금액을 자동으로 채워줘요.' },
    ],
  },
};

function openHelpModal() {
  const activeTab = document.querySelector('.tab-btn.active')?.id?.replace('tab-', '') || 'dashboard';
  const data = HELP_CONTENT[activeTab] || HELP_CONTENT.dashboard;

  document.getElementById('helpTabLabel').textContent = data.label;
  // stat-detail은 대시보드 서브탭이므로 dashboard 도움말로 폴백
  document.getElementById('helpContent').innerHTML = data.items.map(item =>
    `<div style="display:flex;gap:12px;align-items:flex-start;">
      <span style="font-size:20px;flex-shrink:0;margin-top:1px;">${escAdmin(item.icon)}</span>
      <div>
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:3px;">${escAdmin(item.title)}</div>
        <div style="font-size:13px;color:#6b7280;line-height:1.6;">${escAdmin(item.desc)}</div>
      </div>
    </div>`
  ).join('');

  document.getElementById('helpModalOverlay').style.display = 'flex';
}

function closeHelpModal(e) {
  if (e && e.target !== document.getElementById('helpModalOverlay')) return;
  document.getElementById('helpModalOverlay').style.display = 'none';
}
