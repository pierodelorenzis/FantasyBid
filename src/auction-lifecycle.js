import { fetchAuction, verifyAdminAccess } from "./auction-service.js";
import { toast } from "./ui.js";

export function createAuctionLifecycle({
  getSession,
  setSession,
  setAuction,
  getActivePage,
  saveSession,
  forgetSession,
  stopRealtime,
  startRealtime,
  render,
  landing,
}) {
  async function load() {
    const session = getSession();
    if (!session) return landing();
    stopRealtime();
    try {
      setAuction(await fetchAuction(session));
      render(getActivePage());
      startRealtime();
    } catch {
      forgetSession(session.code);
      setSession(null);
      landing();
      toast("Asta non trovata");
    }
  }

  async function activateAdminLink(code, token) {
    const access = await verifyAdminAccess(code, token);
    saveSession({
      code,
      token,
      role: access.role,
      name: access.name,
    });
    await load();
  }

  function invalidate() {
    const expiredCode = getSession()?.code;
    stopRealtime();
    if (expiredCode) forgetSession(expiredCode);
    setSession(null);
    landing();
    toast("Sessione scaduta. Usa un nuovo link di accesso.");
  }

  return { activateAdminLink, invalidate, load };
}
