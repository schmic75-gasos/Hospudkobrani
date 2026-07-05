import { trackEvent as _trackEvent } from './track';
import { apiFetch } from '../api';

export const reportError = (err, ctx={}) => {
  try {
    _trackEvent('error', { message: String(err).slice(0,300), ...ctx });
  } catch {}
};
