const $ = (s) => document.querySelector(s),
  $$ = (s) => document.querySelectorAll(s),
  app = $("#app");
let session = JSON.parse(localStorage.getItem("fantabid-session") || "null"),
  auction = null,
  refresh,
  auctionEvents,
  activePage = "live",
  selectedImportFile = null,
  catalogRole = "POR",
  catalogTier = "all",
  catalogPage = 1,
  mobileMenuOpen = false,
  dismissedRosterWarningKey = null,
  activeRosterWarningKey = null;
const api = async (path, opts = {}) => {
  const r = await fetch("/api" + path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Operazione non riuscita");
  return d;
};
const toast = (t) => {
  const e = $("#toast");
  e.textContent = t;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 2500);
};
const renderIcons = () =>
  window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
const ownerApi = async (path, opts = {}) => {
  const token = sessionStorage.getItem("fantabid-owner-token") || "";
  const r = await fetch("/api/owner" + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      "x-owner-token": token,
      ...(opts.headers || {}),
    },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Operazione non riuscita");
  return d;
};
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
    const totalParticipants = auctions.reduce((sum, item) => sum + item.participants, 0);
    const totalAssigned = auctions.reduce((sum, item) => sum + item.assigned, 0);
    const liveAuctions = auctions.filter((item) => item.status === "live").length;
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
function confirmDialog(title, message, confirmLabel = "Rimuovi") {
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
function creditDialog(participantName) {
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
function catalogPlayerDialog(tiers) {
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
const money = (n) => "ƒ " + n;
function landing() {
  stop();
  app.innerHTML = `<main class="landing"><nav class="land-nav"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><button id="showJoin" class="ghost">Entra in un'asta <i data-lucide="arrow-right"></i></button></nav><section class="hero"><p class="eyebrow">L'ASTA DEL FANTACALCIO, SEMPLIFICATA</p><h1>Tutta la tua lega.<br><em>Un'unica asta.</em></h1><p class="lead">Crea una stanza, condividi il link e gestisci ogni rilancio in tempo reale.</p><button class="primary big" id="showCreate">Crea una nuova asta <i data-lucide="arrow-right"></i></button></section><div class="features"><span><i data-lucide="circle-check"></i> Nessuna registrazione</span><span><i data-lucide="sliders-horizontal"></i> Regole personalizzabili</span><span><i data-lucide="download"></i> Export CSV incluso</span></div></main>`;
  renderIcons();
  $("#showCreate").onclick = createForm;
  $("#showJoin").onclick = joinForm;
}
function createForm() {
  app.innerHTML = `<main class="auth"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><section class="auth-card"><button class="back"><i data-lucide="arrow-left"></i> Indietro</button><p class="eyebrow">AMMINISTRATORE</p><h1>Crea la tua asta</h1><p>Imposta i dettagli iniziali. Potrai modificare le regole dalla dashboard.</p><form id="create"><label>Nome della lega<input name="name" required placeholder="es. Amici del calcetto"></label><label>Il tuo nome<input name="adminName" required placeholder="es. Marco Rossi"></label><label>Crediti iniziali per squadra<input name="budget" type="number" value="300" min="1" required></label><button class="primary">Crea asta <i data-lucide="arrow-right"></i></button></form></section></main>`;
  renderIcons();
  $(".back").onclick = landing;
  $("#create").onsubmit = async (e) => {
    e.preventDefault();
    try {
      let d = await api("/auctions", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      save({
        code: d.code,
        token: d.adminToken,
        role: "admin",
        name: d.adminName,
      });
      toast("Asta creata");
      load();
    } catch (x) {
      toast(x.message);
    }
  };
}
function joinForm() {
  app.innerHTML = `<main class="auth"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><section class="auth-card"><button class="back"><i data-lucide="arrow-left"></i> Indietro</button><p class="eyebrow">PARTECIPANTE</p><h1>Entra nell'asta</h1><p>Inserisci il codice che ti ha inviato l'amministratore.</p><form id="join"><label>Codice asta<input name="code" required maxlength="6" placeholder="ABC123" style="text-transform:uppercase"></label><label>Il tuo nome<input name="name" required placeholder="es. Luca Gallo"></label><button class="primary">Entra nell'asta <i data-lucide="arrow-right"></i></button></form></section></main>`;
  renderIcons();
  $(".back").onclick = landing;
  $("#join").onsubmit = async (e) => {
    e.preventDefault();
    let f = Object.fromEntries(new FormData(e.target));
    try {
      let d = await api("/auctions/" + f.code.toUpperCase() + "/join", {
        method: "POST",
        body: JSON.stringify({ name: f.name }),
      });
      save({
        code: f.code.toUpperCase(),
        token: d.token,
        role: "participant",
        name: f.name,
      });
      load();
    } catch (x) {
      toast(x.message);
    }
  };
}
function save(s) {
  session = s;
  localStorage.setItem("fantabid-session", JSON.stringify(s));
}
function stop() {
  clearInterval(refresh);
  refresh = null;
  auctionEvents?.close();
  auctionEvents = null;
}
function applyAuctionUpdate(nextAuction) {
  auction = nextAuction;
  if (activePage !== "live") return;
  const activityScroll = $(".auction-sidebar .recent")?.scrollTop || 0;
  const pendingAmount = $("#amount")?.value;
  const wasEditingAmount = document.activeElement?.id === "amount";
  render(activePage);
  const activityTable = $(".auction-sidebar .recent");
  if (activityTable) activityTable.scrollTop = activityScroll;
  const amountInput = $("#amount");
  if (amountInput && pendingAmount && Number.isFinite(+pendingAmount)) {
    amountInput.value = Math.max(+amountInput.min, +pendingAmount);
    $("#offerAmount").textContent = money(amountInput.value);
    if (wasEditingAmount) amountInput.focus();
  }
}
async function refreshAuction() {
  const nextAuction = await api(
    "/auctions/" + session.code + "?token=" + session.token,
  );
  applyAuctionUpdate(nextAuction);
}
function startFallbackPolling() {
  if (refresh) return;
  refresh = setInterval(async () => {
    try {
      await refreshAuction();
    } catch {}
  }, 30000);
}
function startAuctionEvents() {
  auctionEvents = new EventSource(
    `/api/auctions/${encodeURIComponent(session.code)}/events?token=${encodeURIComponent(session.token)}`,
  );
  auctionEvents.addEventListener("auction", (event) => {
    try {
      const update = JSON.parse(event.data);
      applyAuctionUpdate(update.auction);
    } catch {}
  });
  auctionEvents.onopen = () => {
    clearInterval(refresh);
    refresh = null;
  };
  auctionEvents.onerror = startFallbackPolling;
}
async function load() {
  if (!session) return landing();
  stop();
  try {
    auction = await api(
      "/auctions/" + session.code + "?token=" + session.token,
    );
    render(activePage);
    startAuctionEvents();
  } catch (e) {
    localStorage.removeItem("fantabid-session");
    session = null;
    landing();
    toast("Asta non trovata");
  }
}
function nav(page = "live") {
  const admin = session.role === "admin";
  return `<aside><div class="menu-brand"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><button id="closeMobileMenu" class="mobile-menu-close" aria-label="Chiudi menu"><i data-lucide="x"></i></button></div><button class="nav ${page === "live" ? "active" : ""}" data-page="live"><i data-lucide="gavel"></i> Asta live</button>${admin ? `<button class="nav ${page === "teams" ? "active" : ""}" data-page="teams"><i data-lucide="users"></i> Squadre partecipanti</button><button class="nav ${page === "admin" ? "active" : ""}" data-page="admin"><i data-lucide="settings"></i> Gestione asta</button>` : `<button class="nav ${page === "team" ? "active" : ""}" data-page="team"><i data-lucide="shirt"></i> La mia squadra</button>`}<div class="side-user"><div class="avatar">${initials(session.name)}</div><div><b>${session.name}</b><small>${admin ? "Admin" : "Partecipante"}</small></div><button id="logout" aria-label="Esci dall'asta"><i data-lucide="log-out"></i></button></div></aside>`;
}
function render(page = "live") {
  activePage = page;
  app.innerHTML = `<div class="shell ${mobileMenuOpen ? "menu-open" : ""}">${nav(page)}<section class="content"><header><button id="mobileMenu" class="mobile-menu" aria-label="Apri menu"><i data-lucide="menu"></i></button><span class="crumb">${auction.name} <b>·</b> Codice <strong>${auction.code}</strong></span>${session.role === "admin" ? '<button id="share" class="ghost">Condividi link <i data-lucide="share-2"></i></button>' : ""}</header><div class="page">${page === "live" ? live() : page === "team" ? team() : page === "teams" ? teams() : admin()}</div></section></div>`;
  renderIcons();
  $$(".nav").forEach(
    (x) =>
      (x.onclick = () => {
        mobileMenuOpen = false;
        render(x.dataset.page);
      }),
  );
  $("#mobileMenu").onclick = () => {
    mobileMenuOpen = !mobileMenuOpen;
    $(".shell").classList.toggle("menu-open", mobileMenuOpen);
  };
  $("#closeMobileMenu").onclick = () => {
    mobileMenuOpen = false;
    $(".shell").classList.remove("menu-open");
  };
  $("#logout").onclick = async () => {
    if (
      !(await confirmDialog(
        "Uscire dall'asta?",
        "La sessione verrà rimossa solo da questo dispositivo. Potrai rientrare usando il codice dell'asta.",
        "Esci dall'asta",
      ))
    )
      return;
    localStorage.removeItem("fantabid-session");
    session = null;
    landing();
  };
  if ($("#share"))
    $("#share").onclick = () => {
      navigator.clipboard?.writeText(location.origin + "/?asta=" + auction.code);
      toast("Link copiato: condividilo con la lega");
    };
  wire(page);
}
function live() {
  let p = auction.currentPlayer;
  let my = me();
  if (!p)
    return `<div class="empty"><h1>${session.role === "admin" ? "Importa il catalogo giocatori." : "Il catalogo giocatori non è ancora disponibile."}</h1><p>${session.role === "admin" ? "Vai in Gestione asta e carica il file CSV o XLSX prima di avviare l’asta." : "Attendi che l’amministratore carichi il catalogo e avvii l’asta."}</p></div>`;
  let min = p.highestBid
    ? p.highestBid.amount + auction.rules[p.tier].increment
    : auction.rules[p.tier].minPrice;
  let lastBidder = !p.highestBid
    ? "Nessuna offerta"
    : p.highestBid.participantToken === session.token
      ? '<span class="your-last-bid">Tu</span>'
      : p.highestBid.participantName;
  let roleArtwork =
    { POR: "🧤", DIF: "🛡️", CEN: "🧭", ATT: "🎯" }[p.role] || "⚽";
  let warning = false;
  let side =
    session.role === "admin"
      ? `<article class="bid-panel admin-control"><p>Controllo amministratore</p><h2>${auction.participants.filter((x) => x.role === "participant").length} <small>partecipanti</small></h2><hr><p>Osserva i rilanci, assegna il giocatore all'offerta più alta e chiama il successivo.</p><button id="closePlayer" class="primary">Assegna e chiama il prossimo</button></article>`
      : `<article class="bid-panel"><p>La tua disponibilità</p><h2>${money(my.budget - (my.committed || 0))} <small>crediti</small></h2><div class="bar-label"><span>Budget impegnato</span><b>${my.committed || 0} / ${my.budget}</b></div><div class="bar"><i style="width:${((my.committed || 0) / my.budget) * 100}%"></i></div><hr><label>La tua offerta <small>min. ${money(min)}</small></label><div class="offer"><button id="minus">−</button><input id="amount" type="number" min="${min}" value="${min}"><button id="plus">+</button></div>${warning ? `<div class="warning"><b>!</b><p><strong>Attenzione al completamento rosa</strong>Questa offerta potrebbe lasciarti senza crediti per completare i ${auction.remainingSlots} giocatori mancanti.</p></div>` : ""}<button id="bid" class="primary" ${auction.canBid ? "" : "disabled"}>Fai la tua offerta <span id="offerAmount">${money(min)}</span></button><small class="note">Il server convalida disponibilità, rilanci minimi e tetti per fascia.</small></article>`;
  let table = `<section class="recent"><div class="activity-head"><div><p class="eyebrow">ULTIMI MOVIMENTI</p><h2>Il tavolo dell'asta</h2></div>${session.role === "admin" ? `<div class="activity-actions"><button id="undoActivity" class="ghost" ${auction.canUndo ? "" : "disabled"}>Annulla ultima</button><button id="clearActivity" class="danger">Cancella movimenti</button></div>` : ""}</div>${
    auction.activity
      .map(
        (a) =>
          `<div class="move"><span class="avatar">${initials(a.name)}</span><span><b>${a.name}</b><small>${a.action}</small></span>${a.amount ? `<em>${money(a.amount)}</em>` : ""}</div>`,
      )
      .join("") || '<p class="muted">Ancora nessun movimento.</p>'
  }</section>`;
  let warningDetails = auction.rosterWarning?.notEnoughAvailablePlayers
    ? `Restano solo ${auction.rosterWarning.availablePlayers} giocatori disponibili per ${auction.rosterWarning.remainingSlots} posti da coprire.`
    : `Per completare i ${auction.rosterWarning?.remainingSlots} posti mancanti servono almeno ${money(auction.rosterWarning?.minimumRequiredCredits)}: la somma dei prezzi di partenza più bassi dei giocatori ancora disponibili.`;
  let rosterWarningKey = auction.rosterWarning
    ? [
        auction.code,
        p.id,
        p.highestBid?.amount || 0,
        auction.rosterWarning.participantName,
        auction.rosterWarning.remainingCredits,
        auction.rosterWarning.minimumRequiredCredits,
      ].join(":")
    : null;
  activeRosterWarningKey = rosterWarningKey;
  if (!rosterWarningKey) dismissedRosterWarningKey = null;
  let sharedWarning =
    rosterWarningKey && dismissedRosterWarningKey !== rosterWarningKey
      ? `<div class="shared-roster-warning" role="alert"><i class="warning-icon" data-lucide="triangle-alert"></i><p><strong>Attenzione per ${auction.rosterWarning.participantName}</strong>Dopo questa offerta restano ${money(auction.rosterWarning.remainingCredits)}. ${warningDetails}</p><button id="dismissRosterWarning" aria-label="Chiudi avviso"><i data-lucide="x"></i></button></div>`
      : "";
  return `${sharedWarning}<div class="live-layout"><div class="live-main"><div class="live-status-row"><span class="auction-status ${auction.status === "live" ? "live" : "paused"}"><i></i>${auction.status === "live" ? "Asta in corso" : "Asta in pausa"}</span></div><div class="countdown-slot"></div><div class="auction-grid"><article class="player-card"><div class="player-hero"><span class="role">${p.role}</span><span class="tier">★ Fascia ${p.tier}</span><strong>${p.number}</strong><div class="role-art role-${p.role.toLowerCase()}" aria-label="${p.role}">${roleArtwork}</div></div><div class="player-name"><h2>${p.name}</h2><span class="mobile-player-meta">${p.role} · Fascia ${p.tier}</span><div class="player-details"><p>${p.team} · ${p.nation}</p><span class="player-quote">Quotazione <b>${Number.isFinite(+p.quote) ? p.quote : 0}</b></span></div></div><div class="bid-info"><div><small>OFFERTA ATTUALE</small><b class="current-bid">${money(p.highestBid?.amount || 0)}</b></div><div><small>ULTIMA PUNTATA VALIDA</small><p>${lastBidder}</p></div></div></article>${side}</div></div><section class="auction-sidebar">${table}</section></div>`;
}
function team() {
  let m = me(),
    players = m.players || [];
  return `<div class="title-row"><div><p class="eyebrow">${session.name.toUpperCase()}</p><h1>La mia <em>rosa.</em></h1></div><button id="exportTeam" class="ghost"><i data-lucide="download"></i> Esporta CSV</button></div><div class="stats"><div><small>CREDITI RESIDUI</small><b>${money(m.budget - (m.committed || 0))}</b></div><div><small>GIOCATORI ACQUISTATI</small><b>${players.length} <i>/ ${auction.totalSlots}</i></b></div><div><small>CREDITI SPESI</small><b>${money(m.committed || 0)}</b></div></div><div class="table"><div class="thead"><span>GIOCATORE</span><span>RUOLO</span><span>SQUADRA</span><span>ACQUISTO</span></div>${players.map((p) => `<div><b>${p.name}</b><span>${p.role}</span><span>${p.team}</span><em>${money(p.price)}</em></div>`).join("") || '<p class="muted pad">Nessun giocatore acquistato.</p>'}</div>`;
}
function teams() {
  let ps = auction.participants.filter((p) => p.role === "participant");
  return `<div class="title-row"><div><p class="eyebrow">VISIONE AMMINISTRATORE</p><h1>Squadre dei <em>partecipanti.</em></h1></div><button id="exportAll" class="ghost"><i data-lucide="download"></i> Resoconto CSV</button></div>${ps.map((p) => `<section class="admin-card"><div class="team-card-head"><h2>${p.name} <small class="muted">${p.players.length}/${auction.totalSlots} giocatori · ${money(p.budget - p.committed)} residui</small></h2><div class="team-card-actions"><button class="ghost add-credits" data-participant="${p.token}" data-participant-name="${p.name}">+ Aggiungi crediti</button><button class="danger remove-participant" data-participant="${p.token}">Rimuovi squadra</button></div></div><div class="table team-table">${p.players.length ? `<div class="thead"><span>GIOCATORE</span><span>RUOLO</span><span>SQUADRA</span><span>ACQUISTO</span><span></span></div>${p.players.map((x) => `<div><b>${x.name}</b><span>${x.role}</span><span>${x.team}</span><em>${money(x.price)}</em><button class="ghost remove-team-player" data-participant="${p.token}" data-player="${x.id}">Rimuovi</button></div>`).join("")}` : '<p class="muted pad">Nessun giocatore acquistato.</p>'}</div></section>`).join("") || '<div class="empty"><h1>Nessun partecipante ancora.</h1></div>'}`;
}
function tierRowMarkup(tier = {}) {
  return `<fieldset class="tier-row"><label>Nome<input data-tier-name value="${tier.name || ""}" maxlength="8" required></label><label>Soglia quotazione<input data-tier-min-quote type="number" min="0" value="${tier.minQuote ?? 0}" required></label><label>Base<input data-tier-min-price type="number" min="0" value="${tier.minPrice ?? 1}" required></label><label>Rilancio<input data-tier-increment type="number" min="0" value="${tier.increment ?? 1}" required></label><label>Tetto<input data-tier-cap type="number" min="0" value="${tier.cap ?? 50}" required></label><button type="button" class="danger remove-tier">Rimuovi fascia</button></fieldset>`;
}
function admin() {
  let tiers = auction.tierSettings || [];
  return `<div class="title-row"><div><p class="eyebrow">AMMINISTRAZIONE</p><h1>Gestisci l'<em>asta.</em></h1></div><button id="exportAll" class="ghost"><i data-lucide="download"></i> Resoconto CSV</button></div><div class="admin-card"><h2>Importa giocatori</h2><p>Carica un CSV oppure un XLSX con un solo foglio, contenente tutti i giocatori. La riga delle intestazioni deve usare: <b>Nome</b>, <b>Ruolo</b> (POR, DIF, CEN o ATT), <b>Squadra</b>, <b>Quotazione</b>. La colonna <b>Nazione</b> è facoltativa. Ogni giocatore deve comparire una sola volta.</p><input id="playerFile" type="file" accept=".csv,.xlsx"><div class="import-actions"><button id="importPlayers" class="primary">Importa catalogo <i data-lucide="upload"></i></button><span id="importLoader" class="import-loader" hidden role="status"><i data-lucide="loader-circle"></i> Caricamento…</span></div><p id="importResult" class="muted"></p></div><div class="admin-card"><h2>Fasce e regole d’asta</h2><p>Definisci soglia di quotazione, prezzo base, rilancio e tetto. Le fasce sono ordinate automaticamente dalla soglia più alta.</p><form id="rules"><div id="tierRows">${tiers.map(tierRowMarkup).join("")}</div><button type="button" id="addTier" class="ghost">+ Aggiungi fascia</button><div class="tier-actions"><button class="primary">Salva fasce e regole</button><button type="button" id="recalculateTiers" class="ghost"><i data-lucide="rotate-ccw"></i> Ricalcola fasce dei giocatori</button></div></form></div><div class="admin-card"><h2>Link partecipanti</h2><p>Per entrare basta il codice dell'asta e il proprio nome: non è richiesta alcuna password.</p><div class="linkbox">${location.origin}/?asta=${auction.code}<button id="copyCode">Copia</button></div></div>`;
}
function wire(page) {
  if (page === "live") showCountdown();
  if (page === "live") {
    if ($("#dismissRosterWarning"))
      $("#dismissRosterWarning").onclick = () => {
        dismissedRosterWarningKey = activeRosterWarningKey;
        $(".shared-roster-warning")?.remove();
      };
    let amount = $("#amount");
    if (amount) {
      $("#plus").onclick = () => (amount.value = +amount.value + 1);
      $("#minus").onclick = () =>
        (amount.value = Math.max(+amount.min, +amount.value - 1));
      amount.oninput = () =>
        ($("#offerAmount").textContent = money(amount.value));
      $("#bid").onclick = async () => {
        try {
          let x = await api(`/auctions/${session.code}/bid`, {
            method: "POST",
            body: JSON.stringify({
              token: session.token,
              amount: +amount.value,
            }),
          });
          auction = x.auction;
          render();
          toast("Offerta registrata");
        } catch (e) {
          toast(e.message);
        }
      };
    }
    if ($("#bid") && !auction.canBid && auction.status === "live") {
      $("#bid").disabled = true;
      $("#bid").title = "Sei già in testa con l’ultima offerta";
    }
    if ($("#clearActivity")) {
      $("#clearActivity").onclick = async () => {
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
          auction = result.auction;
          render("live");
          toast("Movimenti cancellati");
        } catch (error) {
          toast(error.message);
        }
      };
    }
    if ($("#undoActivity")) {
      $("#undoActivity").onclick = async () => {
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
          auction = result.auction;
          render("live");
          toast("Ultima operazione annullata");
        } catch (error) {
          toast(error.message);
        }
      };
    }
    if ($("#closePlayer")) {
      let close = $("#closePlayer"),
        toggle = document.createElement("button"),
        countdown = document.createElement("button"),
        actionRow = document.createElement("div"),
        starting = !!auction.startCountdownEndsAt;
      toggle.id = "toggleLive";
      toggle.className = `admin-live-toggle ${auction.status === "live" ? "admin-pause" : "admin-start"}`;
      toggle.textContent = starting
        ? "Avvio programmato"
        : auction.status === "live"
          ? "Metti in pausa"
          : "Avvia asta";
      toggle.disabled = starting;
      countdown.id = "pauseCountdown";
      countdown.className = "admin-countdown";
      countdown.textContent = "Ultima chiamata";
      countdown.disabled =
        auction.status !== "live" || !!auction.countdownEndsAt;
      actionRow.className = "admin-action-row";
      actionRow.append(countdown, toggle);
      close.before(actionRow);
      toggle.onclick = () => adminAction("toggle");
      countdown.onclick = () => adminAction("countdown");
      close.textContent = "Assegna e chiama il prossimo";
      close.onclick = () => adminAction("close");
      adminCallPanel();
    }
  }
  if (page === "team")
    $("#exportTeam").onclick = () =>
      download(
        `/auctions/${session.code}/export/team?token=${session.token}`,
        "rosa.csv",
      );
  if (page === "teams")
    $("#exportAll").onclick = () =>
      download(
        `/auctions/${session.code}/export/all?token=${session.token}`,
        "resoconto.csv",
      );
  if (page === "teams") {
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
            auction = result.auction;
            render("teams");
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
            auction = result.auction;
            render("teams");
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
            auction = result.auction;
            render("teams");
            toast("Giocatore rimosso dalla squadra");
          } catch (error) {
            toast(error.message);
          }
        }),
    );
  }
  if (page === "admin") {
    $("#copyCode").onclick = () => {
      navigator.clipboard?.writeText(
        location.origin + "/?asta=" + auction.code,
      );
      toast("Link copiato");
    };
    $("#exportAll").onclick = () =>
      download(
        `/auctions/${session.code}/export/all?token=${session.token}`,
        "resoconto.csv",
      );
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
      $("#tierRows").insertAdjacentHTML("beforeend", tierRowMarkup());
      wireTierRemovers();
    };
    $("#rules").onsubmit = async (e) => {
      e.preventDefault();
      const tiers = [...$$(".tier-row")].map((row) => ({
        name: row.querySelector("[data-tier-name]").value,
        minQuote: +row.querySelector("[data-tier-min-quote]").value,
        minPrice: +row.querySelector("[data-tier-min-price]").value,
        increment: +row.querySelector("[data-tier-increment]").value,
        cap: +row.querySelector("[data-tier-cap]").value,
      }));
      try {
        let x = await api(`/auctions/${session.code}/rules`, {
          method: "POST",
          body: JSON.stringify({ token: session.token, tiers }),
        });
        auction = x.auction;
        toast("Fasce e regole aggiornate");
        render("admin");
      } catch (e) {
        toast(e.message);
      }
    };
    $("#recalculateTiers").onclick = async () => {
      try {
        let x = await api(`/auctions/${session.code}/recalculate-tiers`, {
          method: "POST",
          body: JSON.stringify({ token: session.token }),
        });
        auction = x.auction;
        toast("Fasce dei giocatori ricalcolate");
        render("admin");
      } catch (e) {
        toast(e.message);
      }
    };
    $("#playerFile").style.display = "none";
    const setImportBusy = (busy) => {
      $("#importPlayers").disabled = busy;
      $("#importLoader").hidden = !busy;
    };
    const uploadPlayers = async () => {
      let file = selectedImportFile || $("#playerFile").files[0],
        result = $("#importResult");
      if (!file) {
        $("#playerFile").click();
        return;
      }
      if (
        !(await confirmDialog(
          "Sostituire il catalogo?",
          "Il nuovo file sostituirà completamente tutti i giocatori del catalogo attuale. L’operazione è disponibile solo quando l’asta non ha offerte o assegnazioni attive.",
          "Sostituisci catalogo",
        ))
      ) {
        selectedImportFile = null;
        $("#playerFile").value = "";
        return;
      }
      result.textContent = `Caricamento di ${file.name}…`;
      setImportBusy(true);
      try {
        let data = await file.arrayBuffer();
        let x = await api(`/auctions/${session.code}/import`, {
          method: "POST",
          body: JSON.stringify({
            token: session.token,
            fileName: file.name,
            data: btoa(String.fromCharCode(...new Uint8Array(data))),
          }),
        });
        selectedImportFile = null;
        auction = x.auction;
        render("admin");
        toast(`Importazione completata: ${x.count} giocatori`);
      } catch (e) {
        selectedImportFile = null;
        $("#playerFile").value = "";
        result.textContent = "Errore importazione: " + e.message;
        toast(e.message);
      } finally {
        setImportBusy(false);
      }
    };
    $("#importPlayers").onclick = uploadPlayers;
    $("#playerFile").onchange = () => {
      selectedImportFile = $("#playerFile").files[0];
      uploadPlayers();
    };
    const panel = document.createElement("section");
    panel.className = "admin-card";
    const drawCatalog = () => {
      let tierNames = auction.tierSettings.map((tier) => tier.name);
      if (catalogTier !== "all" && !tierNames.includes(catalogTier))
        catalogTier = "all";
      let rows = auction.players.filter(
          (p) =>
            p.role === catalogRole &&
            (catalogTier === "all" || p.tier === catalogTier),
        ),
        per = 20,
        pages = Math.max(1, Math.ceil(rows.length / per));
      catalogPage = Math.min(catalogPage, pages);
      let slice = rows.slice((catalogPage - 1) * per, catalogPage * per);
      const isCatalogPlayerLocked = (player) => {
        const normalizedName = String(player.name || "").trim().toLowerCase();
        const hasPlayerMovement = auction.activity.some((entry) => {
          const action = String(entry.action || "").trim().toLowerCase();
          return (
            (action.startsWith("chiama ") || action.startsWith("acquista ")) &&
            action.includes(normalizedName)
          );
        });
        const isInRoster = auction.participants.some((participant) =>
          participant.players?.some((rosterPlayer) =>
            String(rosterPlayer.id) === String(player.id) ||
            (String(rosterPlayer.name || "").trim().toLowerCase() ===
              normalizedName &&
              rosterPlayer.role === player.role &&
              rosterPlayer.team === player.team),
          ),
        );
        return (
          hasPlayerMovement ||
          Boolean(player.highestBid) ||
          isInRoster
        );
      };
      panel.innerHTML = `<div class="catalog-heading"><h2>Catalogo giocatori <small class="muted">${auction.players.length} importati</small></h2><button id="addCatalogPlayer" class="ghost"><i data-lucide="user-plus"></i> Aggiungi giocatore</button></div><div class="catalog-order"><span>Ordine di chiamata</span><button data-player-order="alphabetical" class="${auction.playerOrder === "alphabetical" ? "selected" : ""}">A–Z</button><button data-player-order="random" class="${auction.playerOrder === "random" ? "selected" : ""}">Casuale</button><button data-role-order class="${auction.orderByRole ? "selected" : ""}">Per ruolo</button></div><div class="catalog-tabs">${["POR", "DIF", "CEN", "ATT"].map((r) => `<button data-role="${r}" class="${r === catalogRole ? "selected" : ""}">${r} (${auction.players.filter((p) => p.role === r).length})</button>`).join("")}</div><div class="catalog-tiers">${["all", ...tierNames].map((t) => `<button data-tier="${t}" class="${t === catalogTier ? "selected" : ""}">${t === "all" ? "Tutte le fasce" : "Fascia " + t}</button>`).join("")}</div><p class="muted">${rows.length} giocatori · pagina ${catalogPage} di ${pages}</p><div class="table catalog-table"><div class="thead"><span>GIOCATORE</span><span>RUOLO</span><span>SQUADRA</span><span>QUOTAZIONE</span><span>FASCIA</span><span>AZIONI</span></div>${slice.map((p) => { const locked = isCatalogPlayerLocked(p); const lockReason = "Giocatore già chiamato o assegnato"; return `<div data-player-row="${p.id}"><b>${p.name}</b><span>${p.role}</span><span>${p.team || "—"}</span><span><input data-quote type="number" min="0" step="1" value="${Number.isFinite(+p.quote) ? p.quote : 0}" aria-label="Quotazione di ${p.name}"></span><span><select data-tier-select aria-label="Fascia di ${p.name}">${tierNames.map((t) => `<option value="${t}" ${p.tier === t ? "selected" : ""}>${t}</option>`).join("")}</select></span><span class="catalog-actions"><button class="ghost catalog-save" data-save-player="${p.id}">Salva</button><span class="catalog-remove-wrap" ${locked ? `data-tooltip="${lockReason}"` : ""}><button class="danger catalog-remove" data-remove-player="${p.id}" data-player-name="${p.name}" ${locked ? `disabled aria-label="${lockReason}"` : ""}>Rimuovi</button></span></span></div>`; }).join("") || '<p class="muted pad">Nessun giocatore in questa fascia.</p>'}</div><div class="pager"><button data-page="-1" ${catalogPage === 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i> Precedente</button><button data-page="1" ${catalogPage === pages ? "disabled" : ""}>Successiva <i data-lucide="chevron-right"></i></button></div>`;
      renderIcons();
      panel.querySelector("#addCatalogPlayer").onclick = async () => {
        const player = await catalogPlayerDialog(auction.tierSettings);
        if (!player) return;
        try {
          const response = await api(`/auctions/${session.code}/players`, {
            method: "POST",
            body: JSON.stringify({ token: session.token, ...player }),
          });
          auction = response.auction;
          catalogRole = player.role;
          catalogTier = player.tier;
          catalogPage = 1;
          toast("Giocatore aggiunto al catalogo");
          drawCatalog();
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
              auction = response.auction;
              catalogPage = 1;
              drawCatalog();
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
          auction = response.auction;
          catalogPage = 1;
          drawCatalog();
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
        (b) =>
          (b.onclick = () => {
            catalogRole = b.dataset.role;
            catalogPage = 1;
            drawCatalog();
          }),
      );
      panel.querySelectorAll("[data-tier]").forEach(
        (b) =>
          (b.onclick = () => {
            catalogTier = b.dataset.tier;
            catalogPage = 1;
            drawCatalog();
          }),
      );
      panel.querySelectorAll("[data-page]").forEach(
        (b) =>
          (b.onclick = () => {
            catalogPage += +b.dataset.page;
            drawCatalog();
          }),
      );
      panel.querySelectorAll("[data-save-player]").forEach(
        (b) =>
          (b.onclick = async () => {
            let row = b.closest("[data-player-row]"),
              quote = +row.querySelector("[data-quote]").value,
              tier = row.querySelector("[data-tier-select]").value;
            b.disabled = true;
            try {
              let x = await api(
                `/auctions/${session.code}/players/${b.dataset.savePlayer}`,
                {
                  method: "POST",
                  body: JSON.stringify({ token: session.token, quote, tier }),
                },
              );
              auction = x.auction;
              toast("Giocatore aggiornato");
              drawCatalog();
            } catch (e) {
              toast(e.message);
              b.disabled = false;
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
              auction = response.auction;
              toast("Giocatore rimosso dal catalogo");
              drawCatalog();
            } catch (error) {
              toast(error.message);
              button.disabled = false;
            }
          }),
      );
      panel.querySelectorAll("[data-call-player]").forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            try {
              let x = await api(
                `/auctions/${session.code}/call/${b.dataset.callPlayer}`,
                {
                  method: "POST",
                  body: JSON.stringify({ token: session.token }),
                },
              );
              auction = x.auction;
              toast("Giocatore chiamato");
              render("live");
            } catch (e) {
              toast(e.message);
              b.disabled = false;
            }
          }),
      );
    };
    drawCatalog();
    $("#playerFile").closest(".admin-card").after(panel);
  }
}
function adminCallPanel() {
  let panel = document.createElement("section");
  panel.className = "admin-card live-caller";
  let roles = {
      POR: "Portieri",
      DIF: "Difensori",
      CEN: "Centrocampisti",
      ATT: "Attaccanti",
    },
    available = auction.players;
  panel.innerHTML = `<h2>Chiama un giocatore</h2><p>Seleziona il prossimo nome: i giocatori sono ordinati alfabeticamente per ruolo.</p><div class="caller-groups">${Object.entries(
    roles,
  )
    .map(([role, label]) => {
      let list = available
        .filter((p) => p.role === role)
        .sort((a, b) => a.name.localeCompare(b.name, "it"));
      return `<section><h3>${label} <small>${list.length}</small></h3>${
        list
          .map((p) => {
            const completed = auction.players.indexOf(p) < auction.currentIndex,
              assigned = completed && !!p.highestBid;
            return `<button class="caller-player ${p.id === auction.currentPlayer?.id ? "current" : ""} ${assigned ? "assigned" : ""} ${completed && !assigned ? "called" : ""}" ${completed ? "disabled" : `data-call-player="${p.id}"`}><span>${p.name}</span><small>${p.team || "—"} · Fascia ${p.tier} · Qt. ${Number.isFinite(+p.quote) ? p.quote : 0}${assigned ? ` · Assegnato a ${p.highestBid.participantName}` : completed ? " · Non assegnato" : ""}</small></button>`;
          })
          .join("") || '<p class="muted">Nessun giocatore disponibile.</p>'
      }</section>`;
    })
    .join("")}</div>`;
  panel.querySelectorAll("[data-call-player]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          let x = await api(
            `/auctions/${session.code}/call/${b.dataset.callPlayer}`,
            { method: "POST", body: JSON.stringify({ token: session.token }) },
          );
          auction = x.auction;
          render("live");
          toast("Giocatore chiamato");
        } catch (e) {
          toast(e.message);
          b.disabled = false;
        }
      }),
  );
  $(".auction-grid").after(panel);
}
function showCountdown() {
  let end = auction.countdownEndsAt || auction.startCountdownEndsAt;
  if (!end) return;
  let starting = !!auction.startCountdownEndsAt,
    banner = document.createElement("div");
  banner.className = "auction-countdown" + (starting ? " starting" : "");
  banner.innerHTML = starting
    ? '<i data-lucide="play"></i> Asta al via tra <strong>0</strong> secondi'
    : '<i data-lucide="timer"></i> Giocatore assegnato tra <strong>0</strong> secondi';
  $(".countdown-slot").append(banner);
  renderIcons();
  let counter = banner.querySelector("strong"),
    update = () => {
      let seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      counter.textContent = seconds;
      if (!seconds) clearInterval(timer);
    },
    timer;
  update();
  timer = setInterval(update, 200);
}
async function adminAction(action) {
  try {
    let x = await api(`/auctions/${session.code}/${action}`, {
      method: "POST",
      body: JSON.stringify({ token: session.token }),
    });
    auction = x.auction;
    render();
    toast(
      action === "close"
        ? "Giocatore assegnato"
        : action === "countdown"
          ? "Countdown avviato"
          : "Stato asta aggiornato",
    );
  } catch (e) {
    toast(e.message);
  }
}
function download(url, name) {
  let a = document.createElement("a");
  a.href = "/api" + url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}
function me() {
  return (
    auction.participants.find((x) => x.token === session.token) || {
      budget: auction.budget,
      players: [],
      committed: 0,
    }
  );
}
function initials(n) {
  return n
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
window.addEventListener("load", () => {
  let params = new URLSearchParams(location.search),
    code = params.get("asta");
  if (params.has("owner")) return ownerDashboard();
  if (code && !session) {
    joinForm();
    $("#join [name=code]").value = code.toUpperCase();
  } else load();
});
