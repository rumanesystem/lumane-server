/* ================================================================
   방문자 통계 (Visitor Stats)
   - KPI 카드, 일별 추이, 전환 깔때기, 시간대별, 유입소스별 성과
   - admin.html '방문자 통계' 탭에서 사용
   - dev (lumane-server) 동기화본
================================================================ */

let currentVsRange = 7;
let _vsDailyChart  = null;
let _vsHourlyChart = null;

/* ── HTML 이스케이프 (XSS 방지) ── */
function vsEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ── 방문자 통계 로드 ── */
async function loadVisitorStats(range = 7) {
  currentVsRange = range;
  window.currentVsRange = range;

  document.querySelectorAll('.vs-range-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.range) === range);
  });
  const rangeLabelEl = document.getElementById('vsRangeLabel');
  if (rangeLabelEl) rangeLabelEl.textContent = `${range}일`;

  try {
    const res = await adminFetch(`${SERVER}/api/admin/stats/visitors?range=${range}`, {
      headers: typeof adminHeaders === 'function' ? adminHeaders() : {},
    });
    if (!res.ok) throw new Error('통계 조회 실패');
    const data = await res.json();

    renderVsKpi(data.kpi);
    renderVsDailyChart(data.daily);
    renderVsFunnel(data.funnel);
    renderVsHourlyChart(data.hourly);
    renderVsSourceTable(data.bySource);
  } catch (err) {
    console.error('[visitor-stats] 로드 실패:', err.message);
  }
}

/* ── KPI 카드 ── */
function renderVsKpi(kpi) {
  if (!kpi) return;
  const v = Number(kpi.visitorsToday) || 0;
  const e = Number(kpi.engagedToday)  || 0;
  const q = Number(kpi.quotedToday)   || 0;
  const s = Number(kpi.submittedToday) || 0;
  const pct = (n) => v > 0 ? Math.round((n / v) * 1000) / 10 : 0;

  document.getElementById('vsKpiVisitors').textContent  = v + '명';
  document.getElementById('vsKpiEngaged').textContent   = e + '명';
  document.getElementById('vsKpiQuoted').textContent    = q + '명';
  document.getElementById('vsKpiSubmitted').textContent = s + '명';

  const setRate = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v > 0 ? `방문 대비 ${val}%` : '방문 없음';
  };
  setRate('vsKpiEngagedRate',  pct(e));
  setRate('vsKpiQuotedRate',   pct(q));
  setRate('vsKpiSubmittedRate', pct(s));
}

/* ── 일별 추이 차트 (Chart.js) ── */
function renderVsDailyChart(daily) {
  const canvas = document.getElementById('vsDailyChart');
  if (!canvas || !daily || !Array.isArray(daily)) return;
  if (typeof Chart === 'undefined') {
    console.warn('[visitor-stats] Chart.js 로드 안 됨');
    return;
  }

  const labels   = daily.map(d => d.date.slice(5));
  const visitors = daily.map(d => d.visitors || 0);
  const engaged  = daily.map(d => d.engaged  || 0);
  const quoted   = daily.map(d => d.quoted   || 0);

  if (_vsDailyChart) _vsDailyChart.destroy();
  _vsDailyChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '방문',   data: visitors, backgroundColor: '#a78bfa' },
        { label: '대화',   data: engaged,  backgroundColor: '#3b82f6' },
        { label: '견적',   data: quoted,   backgroundColor: '#10b981' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { position: 'bottom' } },
    },
  });
}

/* ── 전환 깔때기 ── */
function renderVsFunnel(funnel) {
  const el = document.getElementById('vsFunnel');
  if (!el || !funnel) return;

  const v = Number(funnel.visited)   || 0;
  const e = Number(funnel.engaged)   || 0;
  const q = Number(funnel.quoted)    || 0;
  const s = Number(funnel.submitted) || 0;

  const steps = [
    { label: '방문',      count: v, color: '#a78bfa' },
    { label: '대화 시작', count: e, color: '#3b82f6' },
    { label: '견적 출력', count: q, color: '#10b981' },
    { label: '접수 처리', count: s, color: '#f59e0b' },
  ];

  el.innerHTML = steps.map((step, i) => {
    const widthPct = v > 0 ? Math.max((step.count / v) * 100, step.count > 0 ? 8 : 2) : 2;
    const ratePct  = v > 0 ? Math.round((step.count / v) * 1000) / 10 : 0;
    return `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;">
          <span>${vsEsc(step.label)}</span>
          <span><strong style="color:#111827;">${step.count}명</strong> ${i > 0 ? `(${ratePct}%)` : ''}</span>
        </div>
        <div style="background:#f3f4f6;border-radius:6px;height:24px;overflow:hidden;">
          <div style="width:${widthPct}%;height:100%;background:${step.color};transition:width .3s;"></div>
        </div>
      </div>`;
  }).join('');
}

/* ── 시간대별 분포 차트 ── */
function renderVsHourlyChart(hourly) {
  const canvas = document.getElementById('vsHourlyChart');
  if (!canvas || !hourly || !Array.isArray(hourly)) return;
  if (typeof Chart === 'undefined') return;

  const labels = hourly.map(h => `${h.hour}시`);
  const counts = hourly.map(h => h.conversations || 0);

  if (_vsHourlyChart) _vsHourlyChart.destroy();
  _vsHourlyChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '대화 시작 수',
        data: counts,
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124,58,237,0.1)',
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { display: false } },
    },
  });
}

/* ── 유입소스별 성과 표 ── */
function renderVsSourceTable(bySource) {
  const tbody = document.getElementById('vsSourceTbody');
  if (!tbody) return;
  if (!bySource || bySource.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="padding:20px;text-align:center;color:#9ca3af;">데이터 없음</td></tr>';
    return;
  }
  tbody.innerHTML = bySource.map(row => {
    const landing  = row.landing  ?? 0;
    const chatRate = row.chatRate ?? 0;
    return `
    <tr style="border-bottom:1px solid #f3f4f6;">
      <td style="padding:10px 8px;font-weight:600;color:#111827;">${vsEsc(row.src)}</td>
      <td style="padding:10px 8px;text-align:right;color:#8b5cf6;">${landing}</td>
      <td style="padding:10px 8px;text-align:right;">${row.visitors}</td>
      <td style="padding:10px 8px;text-align:right;color:#3b82f6;">${row.engaged}</td>
      <td style="padding:10px 8px;text-align:right;color:#10b981;">${row.quoted}</td>
      <td style="padding:10px 8px;text-align:right;color:#f59e0b;">${row.submitted}</td>
      <td style="padding:10px 8px;text-align:right;color:#6b7280;">${chatRate}%</td>
      <td style="padding:10px 8px;text-align:right;color:#6b7280;">${row.engageRate}%</td>
      <td style="padding:10px 8px;text-align:right;color:#6b7280;">${row.quoteRate}%</td>
    </tr>
  `;}).join('');
}

/* ── 전역 노출 (admin.js에서 호출용) ── */
window.loadVisitorStats = loadVisitorStats;
window.currentVsRange   = currentVsRange;
