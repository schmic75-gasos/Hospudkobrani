import { trackEvent as _trackEvent } from './telemetry';

export const trackEvent = (name, props = {}) => _trackEvent(name, props);
export const trackError = (err, ctx={}) => _trackEvent('error', { message: String(err).slice(0,300), ...ctx });
