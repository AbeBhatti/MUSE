/**
 * Backend API Configuration
 * 
 * For local development: Leave window.BACKEND_URL unset or empty string
 * For AWS deployment: Set window.BACKEND_URL to your ALB URL
 * 
 * Example for AWS:
 * window.BACKEND_URL = 'https://vybe-alb-1234567890.us-east-1.elb.amazonaws.com';
 * 
 * This file should be replaced during AWS deployment with a version that sets the correct backend URL.
 */

// Default to empty string (same origin) if not already set.
// You can override at runtime by defining window.BACKEND_URL before this file loads.
// For CloudFront + ALB, set to your ALB domain, not CloudFront, if API is on ALB.
if (typeof window.BACKEND_URL === 'undefined' || window.BACKEND_URL === null) {
  // Auto-detect environment
  const hostname = window.location.hostname;
  const isCloudFront = hostname.includes('.cloudfront.net');
  const isLocal = ['localhost', '127.0.0.1'].includes(hostname);
  
  if (isCloudFront) {
    // In production (CloudFront), default to the current origin so API requests stay same-origin.
    window.BACKEND_URL = window.location.origin;
  } else if (isLocal) {
    window.BACKEND_URL = 'http://localhost:1234';
  } else {
    window.BACKEND_URL = '';
  }
}

// Allow overriding BACKEND_URL via query parameter or hash for quick testing.
// Usage:
//   ?backend=https://your-alb-url.com
//   ?api=https://your-alb-url.com
//   #apiBase=https://your-alb-url.com
(function() {
  try {
    const keys = ['backend', 'api', 'apiBase', 'backendUrl'];
    const urlParams = new URLSearchParams(window.location.search);
    const hashValue = window.location.hash.startsWith('#')
      ? window.location.hash.substring(1)
      : window.location.hash;
    const hashParams = new URLSearchParams(hashValue);

    let overrideBackend = null;
    for (const key of keys) {
      overrideBackend = urlParams.get(key) || hashParams.get(key);
      if (overrideBackend) break;
    }

    if (overrideBackend) {
      window.BACKEND_URL = overrideBackend;
      console.log('✅ Backend URL overridden via URL parameter:', overrideBackend);
    }
  } catch (err) {
    console.warn('Unable to parse backend override parameter', err);
  }
})();

// Log configuration for debugging
console.log('🔧 Backend URL:', window.BACKEND_URL || '(same-origin)');

// Provide a gentle reminder when hitting CloudFront without an explicit override.
if (window.BACKEND_URL === window.location.origin && window.location.hostname.includes('.cloudfront.net')) {
  console.log('ℹ️ Using CloudFront origin for API requests. Override with ?backend=https://your-alb-url if needed.');
}
