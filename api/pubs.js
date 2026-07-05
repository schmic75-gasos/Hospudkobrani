import { apiFetch } from './index';

export const getPubs = async (opts = {}) => apiFetch('/pubs');
export const getPub = async (id) => apiFetch(`/pubs/${id}`);
export const searchPubs = async (q) => apiFetch(`/pubs/search?q=${encodeURIComponent(q)}`);
