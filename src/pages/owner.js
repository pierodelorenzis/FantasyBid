import { ownerApi } from "../api.js";
import { $, renderIcons, toast } from "../ui.js";

function ownerDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function ownerStatus(status) {
  return status === "live" ? "In corso" : "In pausa";
}

function ownerEmptyDatabaseDialog() {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "confirm-modal";
    modal.innerHTML = `<section class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="emptyDbTitle"><p class="eyebrow">OPERAZIONE IRREVERSIBILE</p><h2 id="emptyDbTitle">Svuotare tutte le aste?</h2><p>Verranno eliminati definitivamente dal database tutte le aste, le squadre, i giocatori assegnati e i movimenti. Per confermare, scrivi <strong>ELIMINA TUTTE LE ASTE</strong>.</p><form><label class="credit-input">Conferma<input name="confirmation" autocomplete="off" required></label><div class="confirm-actions"><button class="ghost" type="button" data-cancel>Annulla</button><button class="danger" type="submit">Svuota il database</button></div></form></section>`;
    const close = (confirmed = false) => {
      modal.remove();
      resolve(confirmed);
    };
    const form = modal.querySelector("form");
    const input = form.elements.confirmation;
    modal.querySelector("[data-cancel]").onclick = () => close();
    form.onsubmit = (event) => {
      event.preventDefault();
      if (input.value !== "ELIMINA TUTTE LE ASTE") {
        input.setCustomValidity("Inserisci la frase di conferma esatta");
        input.reportValidity();
        return;
      }
      close(true);
    };
    input.oninput = () => input.setCustomValidity("");
    modal.onclick = (event) => {
      if (event.target === modal) close();
    };
    document.body.append(modal);
    input.focus();
  });
}

export function createOwnerPage({ app, stop }) {
  function ownerLogin() {
    stop();
    app.innerHTML = `<main class="auth owner-auth"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><section class="auth-card"><button class="back" id="ownerBack"><i data-lucide="arrow-left"></i> Torna all'app</button><p class="eyebrow">AREA PROPRIETARIO</p><h1>Panoramica globale</h1><p>Inserisci il token privato configurato sul server per accedere alle statistiche di tutte le aste.</p><form id="ownerLogin"><label>Token proprietario<input name="token" type="password" autocomplete="current-password" required autofocus></label><button class="primary">Accedi</button></form></section></main>`;
    renderIcons();
    $("#ownerBack").onclick = () => (location.href = "/");
    $("#ownerLogin").onsubmit = async (event) => {
      event.preventDefault();
      const token = new FormData(event.target).get("token").trim();
      sessionStorage.setItem("fantabid-owner-token", token);
      await ownerDashboard();
    };
  }

  async function ownerDashboard() {
    stop();
    if (!sessionStorage.getItem("fantabid-owner-token")) return ownerLogin();
    app.innerHTML = `<main class="owner-dashboard"><header class="owner-header"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><div><button class="ghost" id="ownerRefresh"><i data-lucide="refresh-cw"></i> Aggiorna</button><button class="ghost" id="ownerLogout"><i data-lucide="log-out"></i> Esci</button></div></header><section class="owner-title"><p class="eyebrow">AREA PROPRIETARIO</p><h1>Tutte le aste</h1><p>Panoramica globale delle aste salvate nel database.</p></section><div id="ownerContent" class="owner-loading">Caricamento dati…</div></main>`;
    renderIcons();
    $("#ownerLogout").onclick = () => {
      sessionStorage.removeItem("fantabid-owner-token");
      ownerLogin();
    };
    $("#ownerRefresh").onclick = ownerDashboard;
    try {
      const { auctions } = await ownerApi("/auctions");
      const totalParticipants = auctions.reduce(
        (sum, item) => sum + item.participants,
        0,
      );
      const totalAssigned = auctions.reduce(
        (sum, item) => sum + item.assigned,
        0,
      );
      const liveAuctions = auctions.filter(
        (item) => item.status === "live",
      ).length;
      $("#ownerContent").innerHTML = `<section class="owner-stats"><article><span>Aste totali</span><strong>${auctions.length}</strong></article><article><span>Aste in corso</span><strong>${liveAuctions}</strong></article><article><span>Partecipanti</span><strong>${totalParticipants}</strong></article><article><span>Giocatori assegnati</span><strong>${totalAssigned}</strong></article></section><section class="owner-table-card"><div class="owner-table-heading"><div><h2>Elenco aste</h2><p>${auctions.length ? "Dati aggiornati dal database." : "Non sono presenti aste nel database."}</p></div></div>${auctions.length ? `<div class="owner-table-wrap"><table class="owner-table"><thead><tr><th>Asta</th><th>Stato</th><th>Partecipanti</th><th>Assegnati</th><th>Giocatore chiamato</th><th>Movimenti</th><th>Aggiornata</th></tr></thead><tbody>${auctions.map((item) => `<tr><td><b>${item.name}</b><small>Codice ${item.code}</small></td><td><span class="owner-status ${item.status === "live" ? "live" : "paused"}">${ownerStatus(item.status)}</span></td><td>${item.participants}</td><td>${item.assigned} / ${item.players}</td><td>${item.currentPlayer || "—"}</td><td>${item.activityCount}</td><td>${ownerDate(item.updatedAt)}</td></tr>`).join("")}</tbody></table></div>` : ""}</section><section class="owner-danger-zone"><div><p class="eyebrow">ZONA PERICOLOSA</p><h2>Svuota il database</h2><p>Elimina ogni asta presente, incluse squadre, assegnazioni e movimenti.</p></div><button class="danger" id="emptyDatabase" ${auctions.length ? "" : "disabled"}>Elimina tutte le aste</button></section>`;
      renderIcons();
      if ($("#emptyDatabase"))
        $("#emptyDatabase").onclick = async () => {
          if (!(await ownerEmptyDatabaseDialog())) return;
          try {
            const result = await ownerApi("/auctions", {
              method: "DELETE",
              body: JSON.stringify({ confirmation: "ELIMINA TUTTE LE ASTE" }),
            });
            toast(`${result.deletedCount} aste eliminate dal database`);
            ownerDashboard();
          } catch (error) {
            toast(error.message);
          }
        };
    } catch (error) {
      sessionStorage.removeItem("fantabid-owner-token");
      $("#ownerContent").innerHTML = `<section class="owner-error"><h2>Accesso non disponibile</h2><p>${error.message}</p><button class="primary" id="retryOwnerLogin">Inserisci di nuovo il token</button></section>`;
      $("#retryOwnerLogin").onclick = ownerLogin;
    }
  }

  return ownerDashboard;
}
