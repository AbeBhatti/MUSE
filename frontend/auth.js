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
    const err = new Error(data.message || data.error || 'Request failed');
    if (data.code) err.code = data.code;
    throw err;
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
    if (err.code === 'UserNotConfirmedException' || /not\s+confirmed/i.test(err.message || '')) {
      setMsg('signin-msg', 'Please verify your email before signing in.', false);
      sessionStorage.setItem('pendingVerificationEmail', email);
      const verEmailInput = document.getElementById('ver-email');
      if (verEmailInput) {
        verEmailInput.value = email;
        verEmailInput.readOnly = true;
      }
      show('signup-section', false);
      show('signin-section', false);
      show('email-ver-section', true);
      const emailVerSection = document.getElementById('email-ver-section');
      if (emailVerSection) {
        emailVerSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => document.getElementById('ver-email-code')?.focus(), 400);
      }
      return;
    }
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
    setMsg('signup-msg', 'Account created! Check your email for the verification code.', true);

    // Store email for verification
    sessionStorage.setItem('pendingVerificationEmail', email);

    // Auto-populate verification email field
    const verEmailInput = document.getElementById('ver-email');
    if (verEmailInput) {
      verEmailInput.value = email;
      verEmailInput.readOnly = true; // Prevent changing it
    }

    // Hide signup/signin sections and show verification
    show('signup-section', false);
    show('signin-section', false);
    show('email-ver-section', true);

    // Scroll to email verification section
    const emailVerSection = document.getElementById('email-ver-section');
    if (emailVerSection) {
      emailVerSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Focus on the verification code input
      setTimeout(() => {
        const codeInput = document.getElementById('ver-email-code');
        if (codeInput) codeInput.focus();
      }, 500);
    }
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
    setMsg('email-verify-msg', 'Email verified! Redirecting to sign in...', true);

    // Clear stored signup email
    sessionStorage.removeItem('signupEmail');

    // Redirect to sign in after successful verification
    setTimeout(() => {
      // Show signin/signup sections again
      show('signup-section', true);
      show('signin-section', true);

      // Pre-populate signin email
      const signinEmailInput = document.getElementById('signin-email');
      if (signinEmailInput) {
        signinEmailInput.value = email;
      }

      // Scroll to signin
      const signinSection = document.getElementById('signin-section');
      if (signinSection) {
        signinSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Focus on password field
      setTimeout(() => {
        const passwordInput = document.getElementById('signin-password');
        if (passwordInput) passwordInput.focus();
      }, 500);
    }, 1500);
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
