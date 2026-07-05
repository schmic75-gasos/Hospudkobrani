import { apiFetch } from './index';

export const login = async (email, password) => apiFetch('/auth/login', { method:'POST', body: JSON.stringify({ email, password }) });
export const logout = async () => apiFetch('/auth/logout', { method:'POST' });
export const getProfile = async () => apiFetch('/profile');
