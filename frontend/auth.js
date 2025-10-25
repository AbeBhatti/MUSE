// frontend/auth.js — minimal client for auth flows

const api = window.AUTH_API || {};

function setMsg(id, text, ok = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = `text-sm ${ok ? 'text-green-600' : 'text-red-600'}`;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: window.AUTH_WITH_CREDENTIALS ? 'include' : 'omit',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || 'Request failed');
  }
  return data;
}

function show(elId, show) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.toggle('hidden', !show);
}

// Sign In
const signinForm = document.getElementById('signin-form');
signinForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('signin-msg', '');
  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;
  try {
    const resp = await post(api.signin, { email, password });

    // Store tokens and user info in localStorage
    localStorage.setItem('idToken', resp.idToken);
    localStorage.setItem('accessToken', resp.accessToken);
    localStorage.setItem('refreshToken', resp.refreshToken);
    localStorage.setItem('userId', resp.userId);
    localStorage.setItem('email', email);

    setMsg('signin-msg', 'Signed in! Redirecting…', true);
    // Redirect to home/editor after login
    setTimeout(() => (window.location.href = 'index.html'), 600);
  } catch (err) {
    setMsg('signin-msg', err.message || 'Sign in failed');
  }
});

// Sign Up
const signupForm = document.getElementById('signup-form');
signupForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('signup-msg', '');
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  try {
    const resp = await post(api.signup, { email, password });
    setMsg('signup-msg', 'Account created! Please verify email/phone.', true);
  } catch (err) {
    setMsg('signup-msg', err.message || 'Sign up failed');
  }
});

// Forgot Password toggle
document.getElementById('link-forgot')?.addEventListener('click', () => {
  show('signin-section', false);
  show('signup-section', false);
  show('reset-request-section', true);
});

document.getElementById('link-back-login')?.addEventListener('click', () => {
  show('reset-request-section', false);
  show('signin-section', true);
  show('signup-section', true);
});

// Request Password Reset
const resetReqForm = document.getElementById('reset-request-form');
resetReqForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('reset-request-msg', '');
  const email = document.getElementById('reset-email').value.trim();
  try {
    await post(api.requestPassword, { email });
    setMsg('reset-request-msg', 'Reset code sent if account exists. Enter it below.', true);
    // Store email for later use
    sessionStorage.setItem('resetEmail', email);
    // Reveal reset form section (token flow)
    show('reset-section', true);
  } catch (err) {
    setMsg('reset-request-msg', err.message || 'Could not send reset link');
  }
});

// Reset Password with token
const resetForm = document.getElementById('reset-form');
resetForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('reset-msg', '');
  const email = sessionStorage.getItem('resetEmail') || document.getElementById('reset-email').value.trim();
  const code = document.getElementById('reset-token').value.trim();
  const password = document.getElementById('reset-password').value;

  if (!email) {
    setMsg('reset-msg', 'Email not found. Please restart the password reset process.');
    return;
  }

  try {
    await post(api.resetPassword, { email, code, password });
    setMsg('reset-msg', 'Password updated. You can sign in now.', true);
    sessionStorage.removeItem('resetEmail');
    setTimeout(() => {
      show('reset-section', false);
      show('signin-section', true);
      show('signup-section', true);
    }, 1500);
  } catch (err) {
    setMsg('reset-msg', err.message || 'Password reset failed');
  }
});

// Email verification
document.getElementById('email-request-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('email-request-msg', '');
  const email = document.getElementById('ver-email').value.trim();
  try {
    await post(api.requestEmailCode, { email });
    setMsg('email-request-msg', 'Verification code sent to email.', true);
  } catch (err) {
    setMsg('email-request-msg', err.message || 'Could not send code');
  }
});

document.getElementById('email-verify-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('email-verify-msg', '');
  const email = document.getElementById('ver-email').value.trim();
  const code = document.getElementById('ver-email-code').value.trim();
  try {
    await post(api.verifyEmailCode, { email, code });
    setMsg('email-verify-msg', 'Email verified!', true);
  } catch (err) {
    setMsg('email-verify-msg', err.message || 'Verification failed');
  }
});

// Phone verification logic removed per request

// If a reset token is present in query, reveal reset section and prefill
(function initFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    show('reset-section', true);
    const input = document.getElementById('reset-token');
    if (input) input.value = token;
  }
})();
