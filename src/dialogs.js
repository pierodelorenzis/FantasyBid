import { adminAccessUrl } from "./routes.js";
import { toast } from "./ui.js";

export function confirmDialog(title, message, confirmLabel = "Rimuovi") {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "confirm-modal";
    modal.innerHTML = `<section class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirmTitle"><p class="eyebrow">CONFERMA OPERAZIONE</p><h2 id="confirmTitle">${title}</h2><p>${message}</p><div class="confirm-actions"><button class="ghost" data-cancel>Annulla</button><button class="danger" data-confirm>${confirmLabel}</button></div></section>`;
    const close = (confirmed) => {
      modal.remove();
      resolve(confirmed);
    };
    modal.querySelector("[data-cancel]").onclick = () => close(false);
    modal.querySelector("[data-confirm]").onclick = () => close(true);
    modal.onclick = (event) => {
      if (event.target === modal) close(false);
    };
    document.body.append(modal);
    modal.querySelector("[data-cancel]").focus();
  });
}

export function adminLinkCreatedDialog(code, token) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    const link = adminAccessUrl(code, token);
    modal.className = "confirm-modal";
    modal.innerHTML = `<section class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="adminLinkTitle"><p class="eyebrow">LEGA CREATA</p><h2 id="adminLinkTitle">Salva il tuo link amministratore</h2><p><b>Conserva questo link:</b> senza il link amministratore e senza una sessione admin già aperta non sarà più possibile accedere alla gestione dell’asta creata.</p><p>Potrai copiarlo nuovamente e, se necessario, rigenerarlo in <b>Gestione asta → Link di accesso</b>.</p><div class="linkbox admin-created-link"><span>${link}</span></div><div class="confirm-actions"><button class="ghost" data-copy-admin>Copia link admin</button><button class="primary" data-continue>Continua</button></div></section>`;
    modal.querySelector("[data-copy-admin]").onclick = async () => {
      try {
        await navigator.clipboard?.writeText(link);
        toast("Link admin copiato");
      } catch {
        toast("Copia non riuscita: seleziona e salva il link mostrato");
      }
    };
    modal.querySelector("[data-continue]").onclick = () => {
      modal.remove();
      resolve();
    };
    document.body.append(modal);
  });
}

export function creditDialog(participantName) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "confirm-modal";
    modal.innerHTML = `<section class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="creditTitle"><p class="eyebrow">ACCREDITO CREDITI</p><h2 id="creditTitle">Aggiungi crediti a ${participantName}</h2><p>Inserisci il numero di crediti da aggiungere al budget della squadra.</p><form><label class="credit-input">Crediti<input name="amount" type="number" min="1" step="1" value="1" required autofocus></label><div class="confirm-actions"><button type="button" class="ghost" data-cancel>Annulla</button><button class="primary" type="submit">Aggiungi crediti</button></div></form></section>`;
    const close = (amount = null) => {
      modal.remove();
      resolve(amount);
    };
    const form = modal.querySelector("form");
    const input = form.elements.amount;
    modal.querySelector("[data-cancel]").onclick = () => close();
    form.onsubmit = (event) => {
      event.preventDefault();
      const amount = Number(input.value);
      if (!Number.isInteger(amount) || amount <= 0) return input.reportValidity();
      close(amount);
    };
    modal.onclick = (event) => {
      if (event.target === modal) close();
    };
    document.body.append(modal);
    input.focus();
    input.select();
  });
}

export function catalogPlayerDialog(tiers) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    const defaultTier = tiers.at(-1)?.name || "";
    modal.className = "confirm-modal";
    modal.innerHTML = `<section class="confirm-card catalog-player-dialog" role="dialog" aria-modal="true" aria-labelledby="catalogPlayerTitle"><p class="eyebrow">CATALOGO GIOCATORI</p><h2 id="catalogPlayerTitle">Aggiungi giocatore</h2><form><div class="catalog-player-fields"><label>Nome<input name="name" required maxlength="100" autofocus></label><label>Ruolo<select name="role" required><option value="POR">Portiere</option><option value="DIF">Difensore</option><option value="CEN">Centrocampista</option><option value="ATT">Attaccante</option></select></label><label>Squadra<input name="team" maxlength="80"></label><label>Nazione<input name="nation" maxlength="80"></label><label>Quotazione<input name="quote" type="number" min="0" step="1" value="0" required></label><label>Fascia<select name="tier" required>${tiers.map((tier) => `<option value="${tier.name}" ${tier.name === defaultTier ? "selected" : ""}>${tier.name}</option>`).join("")}</select></label></div><div class="confirm-actions"><button type="button" class="ghost" data-cancel>Annulla</button><button class="primary" type="submit">Aggiungi giocatore</button></div></form></section>`;
    const close = (player = null) => {
      modal.remove();
      resolve(player);
    };
    const form = modal.querySelector("form");
    modal.querySelector("[data-cancel]").onclick = () => close();
    form.onsubmit = (event) => {
      event.preventDefault();
      const player = Object.fromEntries(new FormData(form));
      player.name = player.name.trim();
      player.team = player.team.trim();
      player.nation = player.nation.trim();
      player.quote = Number(player.quote);
      if (!player.name || !Number.isInteger(player.quote) || player.quote < 0)
        return form.reportValidity();
      close(player);
    };
    modal.onclick = (event) => {
      if (event.target === modal) close();
    };
    document.body.append(modal);
    form.elements.name.focus();
  });
}
