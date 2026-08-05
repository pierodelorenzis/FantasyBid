import { api } from "../api.js";
import { confirmDialog } from "../dialogs.js";
import { adminAccessUrl, auctionUrl } from "../routes.js";
import { $, toast } from "../ui.js";

export function wireAdminAccess({
  auction,
  session,
  stopRealtime,
  saveSession,
  loadAuction,
  renderAdmin,
}) {
  $("#copyCode").onclick = () => {
    navigator.clipboard?.writeText(auctionUrl(auction.code));
    toast("Link copiato");
  };
  $("#copyAdminLink").onclick = () => {
    navigator.clipboard?.writeText(adminAccessUrl(auction.code, session.token));
    toast("Link admin copiato: conservalo in modo sicuro");
  };
  $("#rotateAdminLink").onclick = async () => {
    if (
      !(await confirmDialog(
        "Rigenerare il link amministratore?",
        "Il link precedente e le altre sessioni admin smetteranno di funzionare. Questa sessione resterà collegata con il nuovo link.",
        "Rigenera link",
      ))
    )
      return;
    try {
      stopRealtime();
      const access = await api(`/auctions/${session.code}/admin-link`, {
        method: "POST",
        body: JSON.stringify({ token: session.token }),
      });
      saveSession({ ...session, token: access.token });
      await loadAuction();
      renderAdmin();
      await navigator.clipboard?.writeText(
        adminAccessUrl(access.code, access.token),
      );
      toast("Nuovo link admin copiato");
    } catch (error) {
      toast(error.message);
      await loadAuction();
    }
  };
}
