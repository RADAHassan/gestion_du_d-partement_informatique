const BASE = import.meta.env.VITE_API_URL || '/api';
const KEY = 'fst_token';

export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* stockage indisponible */ } };

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

/** Appel JSON (ou FormData) authentifié par jeton Bearer. */
export async function api(path, { method = 'GET', body, params, blob } = {}) {
  const url = new URL(BASE + path, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && v !== null && url.searchParams.set(k, v));
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  const res = await fetch(url, { method, headers, body: payload });
  if (res.status === 401 && token && !path.startsWith('/auth/login')) onUnauthorized();
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* corps vide */ }
    throw new ApiError(res.status, data.error || `Erreur ${res.status}`, data.details);
  }
  if (res.status === 204) return null;
  return blob ? res.blob() : res.json();
}

/** Télécharge un fichier protégé (en-tête Authorization requis, donc pas de simple lien). */
export async function download(path, filename, params) {
  const blob = await api(path, { blob: true, params });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const fmt = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtDay = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** Valeur d'un <input type="datetime-local"> -> ISO UTC. */
export const toISO = (v) => (v ? new Date(v).toISOString() : '');
/** Date -> valeur pour <input type="datetime-local">. */
export const toLocalInput = (d) => {
  const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
};
