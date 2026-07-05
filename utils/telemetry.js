import { apiFetch } from '../api';

export const trackEvent = async (event, props = {}) => {
  try { await apiFetch('/telemetry', { method:'POST', body: JSON.stringify({ event, props, ts: new Date().toISOString() }) }); } catch {}
};

export const trackError = (message, context = {}) => trackEvent('error', { message, ...context });
