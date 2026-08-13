/* ================================================================
   견적 상세 모달 — 열기 / 닫기 / 수정 저장
================================================================ */

/**
 * 요청사항 메모에서 첨부 사진 URL 추출 후 모달에 미리보기 렌더
 * server.js가 메모 끝에 `[첨부 사진] <URL>` 형식으로 박아둠
 */
function _renderQuotePhoto(memo) {
  const reqEl = document.getElementById('dRequest');
  if (!reqEl) return;

  let slot = document.getElementById('dPhotoSlot');
  if (!slot) {
    slot = document.createElement('div');
    slot.id = 'dPhotoSlot';
    slot.style.marginTop = '8px';
    reqEl.parentNode.insertBefore(slot, reqEl.nextSibling);
  }

  slot.replaceChildren();
  const m = (memo || '').match(/\[첨부 사진\]\s+(https?:\/\/\S+)/);
  if (!m) return;

  // DOM API로 안전 구성 (innerHTML 금지) + 호스트·스킴 화이트리스트
  let url;
  try {
    const u = new URL(m[1]);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    if (!/\.supabase\.co$/i.test(u.hostname)) return; // Supabase Storage 도메인만 허용
    url = u.href;
  } catch { return; }

  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.referrerPolicy = 'no-referrer';
  a.title = '크게 보기';

  const img = document.createElement('img');
  img.alt = '첨부 사진';
  img.referrerPolicy = 'no-referrer';
  img.style.cssText = 'max-width:240px;max-height:240px;border-radius:8px;border:1px solid #e5e7eb;cursor:zoom-in;display:block;';
  img.src = url;

  a.appendChild(img);
  slot.appendChild(a);
}

/**
 * 견적 상세 모달을 엽니다
 */
function openModal(id) {
  // 서버 데이터는 숫자, 문자열 모두 가능 — 타입 무관하게 비교
  const quote = allQuotes.find(q => String(q.id) === String(id));
  if (!quote) return;

  currentQuoteId = id;
  const c = quote.고객정보 || {};

  document.getElementById('modalTitle').textContent = `${quote.접수번호} · ${c.이름 || '-'}`;
  document.getElementById('modalDate').textContent  = `접수일: ${formatDate(quote.접수시간, true)}`;

  setValue('dName',   c.이름);
  setValue('dPhone',  c.연락처);
  setValue('dRegion', c.설치지역);
  setValue('dShape',  c.공간형태);
  setValue('dSize',   c.공간사이즈);

  const opts = Array.isArray(c.추가옵션) ? c.추가옵션.join(', ') : c.추가옵션;
  setValue('dOptions',    opts);
  setValue('dFrameColor', c.프레임색상);
  setValue('dShelfColor', c.선반색상);
  setValue('dPrivacy',    c.개인정보동의);
  setValue('dRequest',    c.요청사항, true);
  _renderQuotePhoto(c.요청사항);

  document.getElementById('editStatus').value    = quote.상태;
  document.getElementById('editManager').value   = quote.담당자 || '';
  document.getElementById('editMemo').value      = quote.메모 || '';
  document.getElementById('editSpecial').value   = quote.특이사항 || '';
  document.getElementById('editFollowup').checked = quote.후속연락필요 || false;

  setValue('dAssignedAt', quote.담당자배정일시 ? formatDate(quote.담당자배정일시, true) : null);
  document.getElementById('dCompletedAt').textContent =
    quote.시공완료일 ? formatDate(quote.시공완료일, true) : '(미완료)';

  document.getElementById('dSource').textContent    = quote.접수경로 || 'AI 루마네 채팅상담';
  document.getElementById('dUpdatedAt').textContent = formatDate(quote.접수시간, true);
  document.getElementById('dSummary').textContent   = quote.대화요약 || '(요약 없음)';

  const chatDone = quote.상담완료여부 !== false;
  document.getElementById('dChatDone').innerHTML =
    `<span class="system-badge ${chatDone ? 'yes' : 'warn'}">${chatDone ? '✓ 완료' : '⚠ 미완료'}</span>`;

  const hasMissing = quote.누락항목여부 === true;
  document.getElementById('dMissing').innerHTML =
    `<span class="system-badge ${hasMissing ? 'warn' : 'yes'}">${hasMissing ? '⚠ 누락항목 있음' : '✓ 없음'}</span>`;

  renderModalHistory(quote);

  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('newBadge').style.display = 'none';
}

/**
 * 모달 내 상담 이력 섹션 렌더링
 */
function renderModalHistory(quote) {
  const list  = quote.상담이력 || [];
  const count = quote.상담이력개수 || list.length || 0;

  document.getElementById('historyChip').textContent = count + '건';

  if (list.length === 0) {
    document.getElementById('modalHistoryList').innerHTML =
      `<div style="font-size:13px;color:#9ca3af;padding:12px 0">이력 없음</div>`;
    return;
  }

  document.getElementById('modalHistoryList').innerHTML = list.map((s, i) => {
    const dateStr  = s.시작일시 ? formatDate(s.시작일시, true) : '-';
    const uniqueId = `hs-${quote.id}-${i}`;

    const msgHtml = (s.메시지목록 || []).map(m => `
      <div class="ht-row ${m.role}">
        ${m.role === 'bot' ? '<div class="ht-av">👩‍💼</div>' : ''}
        <div class="ht-bubble ${m.role}">${escAdmin(m.content)}</div>
      </div>
      <div class="ht-time ${m.role}">${m.time || ''}</div>
    `).join('');

    return `
      <div class="hs-admin-card">
        <div class="hs-admin-head" onclick="toggleAdminTranscript('${uniqueId}', this)">
          <span class="hs-admin-num">${i + 1}회차</span>
          <span class="hs-admin-date">${dateStr}</span>
          <span class="hs-admin-sid">${s.세션ID || '-'}</span>
          ${s.재상담여부 ? '<span class="hs-re-badge">재상담</span>' : ''}
          <button class="hs-expand-btn">원문 보기 ▼</button>
        </div>
        <div class="hs-admin-body">
          <div class="hs-admin-summary">${s.요약 || '-'}</div>
          <div class="hs-last-qa">
            <b>마지막 질문:</b> ${s.마지막질문 || '-'}<br>
            <b>마지막 답변:</b> ${s.마지막답변 || '-'}
          </div>
        </div>
        <div class="hs-transcript-area" id="${uniqueId}">
          <div class="hs-transcript-inner">${msgHtml}</div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 인라인 원문 토글
 */
function toggleAdminTranscript(id, headEl) {
  const area   = document.getElementById(id);
  const btn    = headEl.querySelector('.hs-expand-btn');
  const isOpen = area.classList.contains('open');
  area.classList.toggle('open');
  if (btn) btn.textContent = isOpen ? '원문 보기 ▼' : '원문 닫기 ▲';
}

/**
 * 정보 항목 표시 (값이 없으면 '없음' 표시)
 */
function setValue(id, val, isText = false) {
  const el = document.getElementById(id);
  if (!el) return;

  if (val && String(val).trim()) {
    el.textContent = val;
    el.className   = 'value';
  } else {
    el.textContent = '없음';
    el.className   = 'value empty';
  }
}

/**
 * 모달 닫기
 */
function closeModal(event) {
  if (event && event.target !== document.getElementById('modalOverlay')) return;
  document.getElementById('modalOverlay').classList.remove('open');
  currentQuoteId = null;
}

/**
 * 변경사항 저장 (상태, 담당자, 메모)
 */
async function saveChanges() {
  if (!currentQuoteId) return;

  const status   = document.getElementById('editStatus').value;
  const manager  = document.getElementById('editManager').value;
  const memo     = document.getElementById('editMemo').value;
  const special  = document.getElementById('editSpecial').value;
  const followup = document.getElementById('editFollowup').checked;

  if (serverOnline) {
    try {
      const res = await adminFetch(`${SERVER}/api/quotes/${currentQuoteId}`, {
        method:  'PATCH',
        headers: adminHeaders(),
        body:    JSON.stringify({ status, manager, memo, special, followup }),
      });
      if (!res.ok) throw new Error('저장 실패');
      showToast('✅ 변경사항이 저장되었습니다', 'success');
      await loadQuotes();
    } catch {
      showToast('❌ 저장에 실패했습니다', 'error');
      return;
    }
  } else {
    const quote = allQuotes.find(q => q.id === currentQuoteId);
    if (quote) {
      const wasWithoutManager = !quote.담당자;
      quote.상태     = status;
      quote.담당자   = manager || null;
      quote.메모     = memo;
      quote.특이사항 = special;
      quote.후속연락필요 = followup;
      if (wasWithoutManager && manager) {
        quote.담당자배정일시 = new Date().toISOString();
      }
      if (status === '시공완료' && !quote.시공완료일) {
        quote.시공완료일 = new Date().toISOString();
      }
    }
    showToast('✅ 변경됨 (서버 오프라인 · 재시작 시 초기화)', 'success');
    updateUI();
  }

  closeModal();
}
