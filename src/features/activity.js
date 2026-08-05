import { api } from "../api.js";
import { confirmDialog } from "../dialogs.js";
import { $, toast } from "../ui.js";

export function wireActivityManagement({ session, setAuction, renderLive }) {
  const clear = $("#clearActivity");
  if (clear)
    clear.onclick = async () => {
      if (
        !(await confirmDialog(
          "Cancellare tutti i movimenti?",
          "La cronologia del Tavolo dell’asta verrà svuotata per tutti i partecipanti.",
          "Cancella movimenti",
        ))
      )
        return;
      try {
        const result = await api(`/auctions/${session.code}/clear-activity`, {
          method: "POST",
          body: JSON.stringify({ token: session.token }),
        });
        setAuction(result.auction);
        renderLive();
        toast("Movimenti cancellati");
      } catch (error) {
        toast(error.message);
      }
    };

  const undo = $("#undoActivity");
  if (undo)
    undo.onclick = async () => {
      if (
        !(await confirmDialog(
          "Annullare l’ultima operazione?",
          "Lo stato dell’asta tornerà al momento immediatamente precedente all’ultima operazione.",
          "Annulla operazione",
        ))
      )
        return;
      try {
        const result = await api(`/auctions/${session.code}/undo`, {
          method: "POST",
          body: JSON.stringify({ token: session.token }),
        });
        setAuction(result.auction);
        renderLive();
        toast("Ultima operazione annullata");
      } catch (error) {
        toast(error.message);
      }
    };
}
