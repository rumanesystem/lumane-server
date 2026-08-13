'use strict';

const form = document.getElementById('adminLoginForm');
const submit = document.getElementById('loginSubmit');
const error = document.getElementById('loginError');
const buttonLabel = submit.querySelector('.button-label');
const buttonLoading = submit.querySelector('.button-loading');

function setLoading(loading) {
  submit.disabled = loading;
  form.setAttribute('aria-busy', String(loading));
  buttonLabel.hidden = loading;
  buttonLoading.hidden = !loading;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = '';
  setLoading(true);

  try {
    const response = await fetch('/api/admin-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
      }),
    });
    if (!response.ok) throw new Error('login failed');
    const destination = window.location.pathname.startsWith('/admin-react') ? '/admin-react' : `/admin${window.location.hash}`;
    window.location.replace(destination);
  } catch {
    error.textContent = '로그인할 수 없습니다. 이메일과 비밀번호를 확인해 주세요.';
    setLoading(false);
    form.elements.password.focus();
  }
});
