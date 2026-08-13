/* ============================================
   견적요청 폼 — quote-form.js
   ============================================ */

window._selectedFile = null;

function uuidV4() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── 개인정보 토글 ──────────────────────────────
function togglePrivacy() {
  const detail = document.getElementById('privacy-detail');
  const icon   = document.getElementById('privacy-icon');
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'block';
  if (icon) icon.style.transform = isOpen ? '' : 'rotate(180deg)';
}

// ── 선반 색상 직접 입력 ────────────────────────
function handleShelfColorChange(select) {
  const wrap = document.getElementById('shelf-color-custom-wrap');
  if (wrap) wrap.style.display = select.value === '기타' ? 'block' : 'none';
}

// ── 파일 선택 처리 ────────────────────────────
function onFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  // 사전 검증 — 형식·크기
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    alert('JPG, PNG, WebP 이미지만 첨부할 수 있어요.');
    input.value = '';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('사진 용량이 너무 커요 (10MB 이하). 더 작은 사진을 골라주세요.');
    input.value = '';
    return;
  }

  window._selectedFile = file;

  const label   = document.getElementById('file-label');
  const preview = document.getElementById('file-preview-wrap');
  const img     = document.getElementById('file-preview-img');

  if (label) label.textContent = file.name;
  if (preview && img) {
    const reader = new FileReader();
    reader.onload = e => {
      img.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
}

// ── 이미지 압축 ───────────────────────────────
function compressImage(file, maxW = 1200, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        let w = image.width, h = image.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(image, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.onerror = reject;
      image.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function apiUrl(path) {
  return location.origin + '/' + path;
}

// ── 폼 유효성 검사 ────────────────────────────
function validateQuoteForm() {
  let valid = true;
  const clearError = id => { const el = document.getElementById(id); if (el) el.textContent = ''; };
  const setError   = (id, msg) => { const el = document.getElementById(id); if (el) el.textContent = msg; valid = false; };

  clearError('err-name');
  if (!document.getElementById('q-name').value.trim()) setError('err-name', '이름을 입력해 주세요.');

  clearError('err-phone');
  const phone = document.getElementById('q-phone').value.trim();
  if (!phone) {
    setError('err-phone', '연락처를 입력해 주세요.');
  } else if (!/^[\d\-+]{9,15}$/.test(phone.replace(/\s/g, ''))) {
    setError('err-phone', '올바른 연락처 형식으로 입력해 주세요. (예: 010-0000-0000)');
  }

  clearError('err-region');
  if (!document.getElementById('q-region').value.trim()) setError('err-region', '설치 지역을 입력해 주세요.');

  clearError('err-width');
  if (!document.getElementById('q-width').value) setError('err-width', '가로 사이즈를 입력해 주세요.');

  clearError('err-depth');
  if (!document.getElementById('q-depth').value) setError('err-depth', '세로 사이즈를 입력해 주세요.');

  clearError('err-height');
  if (!document.getElementById('q-height').value) setError('err-height', '높이 사이즈를 입력해 주세요.');

  clearError('err-layout');
  if (document.querySelectorAll('input[name="layout_type"]:checked').length === 0)
    setError('err-layout', '원하는 형태를 하나 이상 선택해 주세요.');

  clearError('err-privacy');
  if (!document.getElementById('q-privacy').checked)
    setError('err-privacy', '개인정보 수집·이용에 동의해 주세요.');

  return valid;
}

let quoteRequestId = null;
let quoteRequestFingerprint = null;

// ── 폼 제출 ───────────────────────────────────
async function submitQuote(event) {
  event.preventDefault();
  if (!validateQuoteForm()) {
    const firstError = document.querySelector('.field-error:not(:empty)');
    if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 제출 중...';

  try {
    let fileData = '', fileName = '';
    const file = window._selectedFile;
    if (file) {
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 사진 처리 중...';
      fileData = await compressImage(file);
      fileName = file.name;
    }

    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 제출 중...';
    const selectedOptions = Array.from(document.querySelectorAll('input[name="options"]:checked')).map(cb => cb.value);

    let shelfColor = document.getElementById('q-shelf-color').value;
    if (shelfColor === '기타') {
      const custom = document.getElementById('q-shelf-color-custom').value.trim();
      shelfColor = custom ? `기타(${custom})` : '기타';
    }

    const textPayload = {
      name:           document.getElementById('q-name').value.trim(),
      phone:          document.getElementById('q-phone').value.trim(),
      region:         document.getElementById('q-region').value.trim(),
      width:          parseFloat(document.getElementById('q-width').value) || 0,
      depth:          parseFloat(document.getElementById('q-depth').value) || 0,
      height:         parseFloat(document.getElementById('q-height').value) || 0,
      layout_type:    Array.from(document.querySelectorAll('input[name="layout_type"]:checked')).map(el => el.value).join(', '),
      options:        selectedOptions,
      frame_color:    document.getElementById('q-frame-color').value || '',
      shelf_color:    shelfColor || '',
      request_memo:   document.getElementById('q-memo').value.trim(),
      privacy_agreed: true,
      status:         '접수',
      file_name:      fileName || '',
      file_data:      fileData || '',
      has_photo:      fileName ? '사진있음' : '',
    };
    const fingerprint = JSON.stringify(textPayload);
    if (!quoteRequestId || quoteRequestFingerprint !== fingerprint) {
      quoteRequestId = uuidV4();
      quoteRequestFingerprint = fingerprint;
    }
    textPayload.request_id = quoteRequestId;

    const res = await fetch(apiUrl('api/quote'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(textPayload),
    });
    if (!res.ok) throw new Error(`저장 실패: ${res.status}`);
    const result = await res.json();

    // 사진 첨부 시도했는데 서버가 거부한 경우 안내
    if (fileName && result.photo_skipped) {
      const msg = {
        size:   '사진 용량이 너무 커서 첨부되지 않았어요.\n견적은 정상 접수되었으니, 카톡으로 사진 따로 보내주세요.',
        format: '사진 형식이 올바르지 않아 첨부되지 않았어요.\n견적은 정상 접수되었으니, 카톡으로 사진 따로 보내주세요.',
        upload: '사진 업로드 중 일시적 오류로 첨부되지 않았어요.\n견적은 정상 접수되었으니, 카톡으로 사진 따로 보내주세요.',
      }[result.photo_skipped] || '사진 첨부가 누락되었어요. 카톡으로 따로 보내주세요. 견적은 정상 접수되었습니다.';
      alert(msg);
    }

    document.getElementById('quote-form').style.display = 'none';
    const successEl = document.getElementById('quote-success');
    successEl.classList.add('show');
    successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    quoteRequestId = null;
    quoteRequestFingerprint = null;

  } catch (err) {
    console.error('[QUOTE_SUBMIT_ERR]', err && err.message);
    alert('제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 견적요청 보내기';
  }
}

// ── 폼 초기화 ─────────────────────────────────
function resetQuoteForm() {
  quoteRequestId = null;
  quoteRequestFingerprint = null;
  const form    = document.getElementById('quote-form');
  const success = document.getElementById('quote-success');
  if (form) {
    form.reset();
    form.style.display = 'block';
    const btn = document.getElementById('submit-btn');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> 견적요청 보내기'; }
    document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
    const wrap = document.getElementById('shelf-color-custom-wrap');
    if (wrap) wrap.style.display = 'none';
    const preview = document.getElementById('file-preview-wrap');
    if (preview) preview.style.display = 'none';
    window._selectedFile = null;
  }
  if (success) success.classList.remove('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
