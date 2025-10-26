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

// Default to empty string (same origin) if not already set
if (typeof window.BACKEND_URL === 'undefined') {
  window.BACKEND_URL = '';
}

