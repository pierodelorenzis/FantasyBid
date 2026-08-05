import { api } from "./api.js";

export function fetchAuction(session) {
  return api(
    `/auctions/${encodeURIComponent(session.code)}?token=${encodeURIComponent(session.token)}`,
  );
}

export async function verifyAdminAccess(code, token) {
  const access = await api(`/auctions/${encodeURIComponent(code)}/access`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  if (access.role !== "admin")
    throw Error("Il link non appartiene a un admin");
  return access;
}
