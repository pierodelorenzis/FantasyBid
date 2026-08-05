import { api } from "../api.js";
import { renderTierRow } from "../pages/admin.js";
import { $, $$, toast } from "../ui.js";

export function wireTierManagement({ session, setAuction, renderAdmin }) {
  const wireTierRemovers = () => {
    $$(".remove-tier").forEach(
      (button) =>
        (button.onclick = () => {
          if ($$(".tier-row").length === 1) {
            toast("Deve rimanere almeno una fascia");
            return;
          }
          button.closest(".tier-row").remove();
        }),
    );
  };

  wireTierRemovers();
  $("#addTier").onclick = () => {
    $("#tierRows").insertAdjacentHTML("beforeend", renderTierRow());
    wireTierRemovers();
  };
  $("#rules").onsubmit = async (event) => {
    event.preventDefault();
    const tiers = [...$$(".tier-row")].map((row) => ({
      name: row.querySelector("[data-tier-name]").value,
      minQuote: +row.querySelector("[data-tier-min-quote]").value,
      minPrice: +row.querySelector("[data-tier-min-price]").value,
      increment: +row.querySelector("[data-tier-increment]").value,
      cap: +row.querySelector("[data-tier-cap]").value,
    }));
    try {
      const result = await api(`/auctions/${session.code}/rules`, {
        method: "POST",
        body: JSON.stringify({ token: session.token, tiers }),
      });
      setAuction(result.auction);
      toast("Fasce e regole aggiornate");
      renderAdmin();
    } catch (error) {
      toast(error.message);
    }
  };
  $("#recalculateTiers").onclick = async () => {
    try {
      const result = await api(
        `/auctions/${session.code}/recalculate-tiers`,
        {
          method: "POST",
          body: JSON.stringify({ token: session.token }),
        },
      );
      setAuction(result.auction);
      toast("Fasce dei giocatori ricalcolate");
      renderAdmin();
    } catch (error) {
      toast(error.message);
    }
  };
}
