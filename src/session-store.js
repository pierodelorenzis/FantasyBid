const sessionStoreKey = "fantabid-sessions";
const legacySessionKey = "fantabid-session";

function readLocalJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
}

export const storedSessions = readLocalJson(sessionStoreKey, {});
const legacySession = readLocalJson(legacySessionKey, null);

if (legacySession?.code && !storedSessions[legacySession.code.toUpperCase()]) {
  storedSessions[legacySession.code.toUpperCase()] = legacySession;
  localStorage.setItem(sessionStoreKey, JSON.stringify(storedSessions));
}
if (legacySession) localStorage.removeItem(legacySessionKey);

export function persistSession(nextSession) {
  const normalized = {
    ...nextSession,
    code: nextSession.code.toUpperCase(),
  };
  storedSessions[normalized.code] = normalized;
  localStorage.setItem(sessionStoreKey, JSON.stringify(storedSessions));
  return normalized;
}

export function removeStoredSession(code) {
  delete storedSessions[String(code).toUpperCase()];
  localStorage.setItem(sessionStoreKey, JSON.stringify(storedSessions));
}
