import { api } from "../api.js";
import { confirmDialog, creditDialog } from "../dialogs.js";
import { $$, money, toast } from "../ui.js";

export function wireTeamManagement({ session, setAuction, renderTeams }) {
  $$(".add-credits").forEach(
    (button) =>
      (button.onclick = async () => {
        const amount = await creditDialog(button.dataset.participantName);
        if (amount === null) return;
        button.disabled = true;
        try {
          const result = await api(
            `/auctions/${session.code}/participants/${button.dataset.participant}/credits`,
            {
              method: "POST",
              body: JSON.stringify({ token: session.token, amount }),
            },
          );
          setAuction(result.auction);
          renderTeams();
          toast(`${money(amount)} aggiunti alla squadra`);
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        }
      }),
  );

  $$(".remove-participant").forEach(
    (button) =>
      (button.onclick = async () => {
        if (
          !(await confirmDialog(
            "Rimuovere questa squadra?",
            "Il partecipante e tutti i giocatori presenti nella sua rosa verranno rimossi dall’asta.",
            "Rimuovi squadra",
          ))
        )
          return;
        try {
          const result = await api(
            `/auctions/${session.code}/participants/${button.dataset.participant}`,
            {
              method: "DELETE",
              body: JSON.stringify({ token: session.token }),
            },
          );
          setAuction(result.auction);
          renderTeams();
          toast("Partecipante rimosso");
        } catch (error) {
          toast(error.message);
        }
      }),
  );

  $$(".remove-team-player").forEach(
    (button) =>
      (button.onclick = async () => {
        if (
          !(await confirmDialog(
            "Rimuovere questo giocatore?",
            "Il giocatore verrà rimosso dalla rosa e i crediti della squadra saranno ricalcolati.",
          ))
        )
          return;
        try {
          const result = await api(
            `/auctions/${session.code}/participants/${button.dataset.participant}/players/${button.dataset.player}`,
            {
              method: "DELETE",
              body: JSON.stringify({ token: session.token }),
            },
          );
          setAuction(result.auction);
          renderTeams();
          toast("Giocatore rimosso dalla squadra");
        } catch (error) {
          toast(error.message);
        }
      }),
  );
}
