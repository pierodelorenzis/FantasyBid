import { api } from "../api.js";
import { catalogPlayerDialog, confirmDialog } from "../dialogs.js";
import { renderIcons, toast } from "../ui.js";

export function createCatalogFeature() {
  let role = "POR";
  let tier = "all";
  let page = 1;

  function wire({ auction: initialAuction, session, setAuction, renderLive }) {
    let auction = initialAuction;
    const panel = document.createElement("section");
    panel.className = "admin-card";
    const updateAuction = (nextAuction) => {
      auction = nextAuction;
      setAuction(nextAuction);
    };
    const draw = () => {
      const tierNames = auction.tierSettings.map((item) => item.name);
      if (tier !== "all" && !tierNames.includes(tier)) tier = "all";
      const rows = auction.players.filter(
        (player) =>
          player.role === role && (tier === "all" || player.tier === tier),
      );
      const perPage = 20;
      const pages = Math.max(1, Math.ceil(rows.length / perPage));
      page = Math.min(page, pages);
      const visibleRows = rows.slice((page - 1) * perPage, page * perPage);
      const isLocked = (player) => {
        const name = String(player.name || "").trim().toLowerCase();
        const hasMovement = auction.activity.some((entry) => {
          const action = String(entry.action || "").trim().toLowerCase();
          return (
            (action.startsWith("chiama ") || action.startsWith("acquista ")) &&
            action.includes(name)
          );
        });
        const isInRoster = auction.participants.some((participant) =>
          participant.players?.some(
            (rosterPlayer) =>
              String(rosterPlayer.id) === String(player.id) ||
              (String(rosterPlayer.name || "").trim().toLowerCase() === name &&
                rosterPlayer.role === player.role &&
                rosterPlayer.team === player.team),
          ),
        );
        return hasMovement || Boolean(player.highestBid) || isInRoster;
      };
      panel.innerHTML = `<div class="catalog-heading"><h2>Catalogo giocatori <small class="muted">${auction.players.length} importati</small></h2><button id="addCatalogPlayer" class="ghost"><i data-lucide="user-plus"></i> Aggiungi giocatore</button></div><div class="catalog-order"><span>Ordine di chiamata</span><button data-player-order="alphabetical" class="${auction.playerOrder === "alphabetical" ? "selected" : ""}">A–Z</button><button data-player-order="random" class="${auction.playerOrder === "random" ? "selected" : ""}">Casuale</button><button data-role-order class="${auction.orderByRole ? "selected" : ""}">Per ruolo</button></div><div class="catalog-tabs">${["POR", "DIF", "CEN", "ATT"].map((itemRole) => `<button data-role="${itemRole}" class="${itemRole === role ? "selected" : ""}">${itemRole} (${auction.players.filter((player) => player.role === itemRole).length})</button>`).join("")}</div><div class="catalog-tiers">${["all", ...tierNames].map((itemTier) => `<button data-tier="${itemTier}" class="${itemTier === tier ? "selected" : ""}">${itemTier === "all" ? "Tutte le fasce" : "Fascia " + itemTier}</button>`).join("")}</div><p class="muted">${rows.length} giocatori · pagina ${page} di ${pages}</p><div class="table catalog-table"><div class="thead"><span>GIOCATORE</span><span>RUOLO</span><span>SQUADRA</span><span>QUOTAZIONE</span><span>FASCIA</span><span>AZIONI</span></div>${visibleRows.map((player) => { const locked = isLocked(player); const reason = "Giocatore già chiamato o assegnato"; return `<div data-player-row="${player.id}"><b>${player.name}</b><span>${player.role}</span><span>${player.team || "—"}</span><span><input data-quote type="number" min="0" step="1" value="${Number.isFinite(+player.quote) ? player.quote : 0}" aria-label="Quotazione di ${player.name}"></span><span><select data-tier-select aria-label="Fascia di ${player.name}">${tierNames.map((itemTier) => `<option value="${itemTier}" ${player.tier === itemTier ? "selected" : ""}>${itemTier}</option>`).join("")}</select></span><span class="catalog-actions"><button class="ghost catalog-save" data-save-player="${player.id}">Salva</button><span class="catalog-remove-wrap" ${locked ? `data-tooltip="${reason}"` : ""}><button class="danger catalog-remove" data-remove-player="${player.id}" data-player-name="${player.name}" ${locked ? `disabled aria-label="${reason}"` : ""}>Rimuovi</button></span></span></div>`; }).join("") || '<p class="muted pad">Nessun giocatore in questa fascia.</p>'}</div><div class="pager"><button data-page="-1" ${page === 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i> Precedente</button><button data-page="1" ${page === pages ? "disabled" : ""}>Successiva <i data-lucide="chevron-right"></i></button></div>`;
      renderIcons();

      panel.querySelector("#addCatalogPlayer").onclick = async () => {
        const player = await catalogPlayerDialog(auction.tierSettings);
        if (!player) return;
        try {
          const response = await api(`/auctions/${session.code}/players`, {
            method: "POST",
            body: JSON.stringify({ token: session.token, ...player }),
          });
          updateAuction(response.auction);
          role = player.role;
          tier = player.tier;
          page = 1;
          toast("Giocatore aggiunto al catalogo");
          draw();
        } catch (error) {
          toast(error.message);
        }
      };
      panel.querySelectorAll("[data-player-order]").forEach(
        (button) =>
          (button.onclick = async () => {
            button.disabled = true;
            try {
              const response = await api(`/auctions/${session.code}/order`, {
                method: "POST",
                body: JSON.stringify({
                  token: session.token,
                  order: button.dataset.playerOrder,
                }),
              });
              updateAuction(response.auction);
              page = 1;
              draw();
              toast(
                button.dataset.playerOrder === "alphabetical"
                  ? "Giocatori ordinati alfabeticamente"
                  : "Giocatori ordinati casualmente",
              );
            } catch (error) {
              toast(error.message);
              button.disabled = false;
            }
          }),
      );
      panel.querySelector("[data-role-order]").onclick = async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const response = await api(`/auctions/${session.code}/order`, {
            method: "POST",
            body: JSON.stringify({
              token: session.token,
              byRole: !auction.orderByRole,
            }),
          });
          updateAuction(response.auction);
          page = 1;
          draw();
          toast(
            auction.orderByRole
              ? "Filtro per ruolo attivato"
              : "Filtro per ruolo rimosso",
          );
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        }
      };
      panel.querySelectorAll("[data-role]").forEach(
        (button) =>
          (button.onclick = () => {
            role = button.dataset.role;
            page = 1;
            draw();
          }),
      );
      panel.querySelectorAll("[data-tier]").forEach(
        (button) =>
          (button.onclick = () => {
            tier = button.dataset.tier;
            page = 1;
            draw();
          }),
      );
      panel.querySelectorAll("[data-page]").forEach(
        (button) =>
          (button.onclick = () => {
            page += +button.dataset.page;
            draw();
          }),
      );
      panel.querySelectorAll("[data-save-player]").forEach(
        (button) =>
          (button.onclick = async () => {
            const row = button.closest("[data-player-row]");
            button.disabled = true;
            try {
              const response = await api(
                `/auctions/${session.code}/players/${button.dataset.savePlayer}`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    token: session.token,
                    quote: +row.querySelector("[data-quote]").value,
                    tier: row.querySelector("[data-tier-select]").value,
                  }),
                },
              );
              updateAuction(response.auction);
              toast("Giocatore aggiornato");
              draw();
            } catch (error) {
              toast(error.message);
              button.disabled = false;
            }
          }),
      );
      panel.querySelectorAll("[data-remove-player]").forEach(
        (button) =>
          (button.onclick = async () => {
            if (
              !(await confirmDialog(
                "Rimuovere il giocatore?",
                `${button.dataset.playerName} verrà eliminato dal catalogo.`,
                "Rimuovi giocatore",
              ))
            )
              return;
            button.disabled = true;
            try {
              const response = await api(
                `/auctions/${session.code}/players/${button.dataset.removePlayer}`,
                {
                  method: "DELETE",
                  body: JSON.stringify({ token: session.token }),
                },
              );
              updateAuction(response.auction);
              toast("Giocatore rimosso dal catalogo");
              draw();
            } catch (error) {
              toast(error.message);
              button.disabled = false;
            }
          }),
      );
      panel.querySelectorAll("[data-call-player]").forEach(
        (button) =>
          (button.onclick = async () => {
            button.disabled = true;
            try {
              const response = await api(
                `/auctions/${session.code}/call/${button.dataset.callPlayer}`,
                {
                  method: "POST",
                  body: JSON.stringify({ token: session.token }),
                },
              );
              updateAuction(response.auction);
              toast("Giocatore chiamato");
              renderLive();
            } catch (error) {
              toast(error.message);
              button.disabled = false;
            }
          }),
      );
    };
    draw();
    document.querySelector("#playerFile").closest(".admin-card").after(panel);
  }

  return { wire };
}
