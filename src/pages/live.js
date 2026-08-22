import { initials, money } from "../ui.js";

const TEAM_PALETTES = [
  ["#172554", "#3b82f6"],
  ["#450a0a", "#ef4444"],
  ["#052e16", "#22c55e"],
  ["#3b0764", "#a855f7"],
  ["#422006", "#f59e0b"],
  ["#083344", "#06b6d4"],
  ["#111827", "#f9fafb"],
  ["#4c0519", "#fb7185"],
];

const TEAM_COLORS = {
  atalanta: ["#111111", "#1675d1"],
  bologna: ["#b51f2a", "#18264b"],
  cagliari: ["#b51f2a", "#18264b"],
  como: ["#1356a2", "#ffffff"],
  fiorentina: ["#5b2a86", "#ffffff"],
  frosinone: ["#f4d000", "#17468f"],
  genoa: ["#c8102e", "#14284b"],
  inter: ["#0b59b5", "#111111"],
  juventus: ["#111111", "#ffffff"],
  lazio: ["#82c8e8", "#ffffff"],
  lecce: ["#f5d000", "#d71920"],
  milan: ["#d71920", "#111111"],
  monza: ["#e30613", "#ffffff"],
  napoli: ["#159bd7", "#ffffff"],
  parma: ["#f2cf00", "#173b70"],
  roma: ["#8e1f2f", "#f5a623"],
  sassuolo: ["#16a34a", "#111111"],
  torino: ["#7a263a", "#ffffff"],
  udinese: ["#111111", "#ffffff"],
  venezia: ["#f36f21", "#087a4b"],
};

const teamKey = (team) => {
  const compact = String(team || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]/g, "")
    .replace(/^(acf|ssc|ac|fc|ss|us)/, "")
    .replace(/calcio$/, "");
  if (["internazionale", "internazionalemilano"].includes(compact))
    return "inter";
  return Object.hasOwn(TEAM_COLORS, compact)
    ? compact
    : Object.keys(TEAM_COLORS).find((name) => compact.endsWith(name)) || compact;
};

function playerArtwork(player) {
  const team = String(player.team || "FantasyBid");
  const paletteIndex = [...team].reduce(
    (total, character) => total + character.codePointAt(0),
    0,
  ) % TEAM_PALETTES.length;
  const [primary, accent] = TEAM_COLORS[teamKey(team)] || TEAM_PALETTES[paletteIndex];
  return `<div class="player-avatar" style="--shirt-primary:${primary};--shirt-accent:${accent}" role="img" aria-label="Maglia di ${team}"><span class="avatar-shirt"><span class="shirt-name">${player.name}</span></span><small>${team}</small></div>`;
}

export function createLivePageRenderer() {
  let dismissedRosterWarningKey = null;
  let activeRosterWarningKey = null;

  function dismissRosterWarning() {
    dismissedRosterWarningKey = activeRosterWarningKey;
  }

  function render({ auction, session, participant }) {
    const player = auction.currentPlayer;
    if (!player)
      return `<div class="empty"><h1>${session.role === "admin" ? "Importa il catalogo giocatori." : "Il catalogo giocatori non è ancora disponibile."}</h1><p>${session.role === "admin" ? "Vai in Gestione asta e carica il file CSV o XLSX prima di avviare l’asta." : "Attendi che l’amministratore carichi il catalogo e avvii l’asta."}</p></div>`;
    const minimum = player.highestBid
      ? player.highestBid.amount + auction.rules[player.tier].increment
      : auction.rules[player.tier].minPrice;
    const lastBidder = !player.highestBid
      ? "Nessuna offerta"
      : player.highestBid.participantToken === session.token
        ? '<span class="your-last-bid">Tu</span>'
        : player.highestBid.participantName;
    const roleArtwork = playerArtwork(player);
    const side =
      session.role === "admin"
        ? `<article class="bid-panel admin-control"><p>Controllo amministratore</p><h2>${auction.participants.filter((item) => item.role === "participant").length} <small>partecipanti</small></h2><hr><p>Osserva i rilanci, assegna il giocatore all'offerta più alta e chiama il successivo.</p><button id="closePlayer" class="primary">Assegna e chiama il prossimo</button></article>`
        : `<article class="bid-panel"><p>La tua disponibilità</p><h2>${money(participant.budget - (participant.committed || 0))} <small>crediti</small></h2><div class="bar-label"><span>Budget impegnato</span><b>${participant.committed || 0} / ${participant.budget}</b></div><div class="bar"><i style="width:${((participant.committed || 0) / participant.budget) * 100}%"></i></div><hr><div class="bid-composer"><label>La tua offerta <small>min. ${money(minimum)}</small></label><div class="offer"><button id="minus">−</button><input id="amount" type="number" min="${minimum}" value="${minimum}"><button id="plus">+</button></div><button id="bid" class="primary" ${auction.canBid ? "" : "disabled"}>Fai la tua offerta <span id="offerAmount">${money(minimum)}</span></button></div><small class="note">Il server convalida disponibilità, rilanci minimi e tetti per fascia.</small></article>`;
    const activity = `<section class="recent"><div class="activity-head"><div><p class="eyebrow">ULTIMI MOVIMENTI</p><h2>Il tavolo dell'asta</h2></div>${session.role === "admin" ? `<div class="activity-actions"><button id="undoActivity" class="ghost" ${auction.canUndo ? "" : "disabled"}>Annulla ultima</button><button id="clearActivity" class="danger">Cancella movimenti</button></div>` : ""}</div>${auction.activity.map((item) => `<div class="move"><span class="avatar">${initials(item.name)}</span><span><b>${item.name}</b><small>${item.action}</small></span>${item.amount ? `<em>${money(item.amount)}</em>` : ""}</div>`).join("") || '<p class="muted">Ancora nessun movimento.</p>'}</section>`;
    const warningDetails = auction.rosterWarning?.notEnoughAvailablePlayers
      ? `Restano solo ${auction.rosterWarning.availablePlayers} giocatori disponibili per ${auction.rosterWarning.remainingSlots} posti da coprire.`
      : `Per completare i ${auction.rosterWarning?.remainingSlots} posti mancanti servono almeno ${money(auction.rosterWarning?.minimumRequiredCredits)}: la somma dei prezzi di partenza più bassi dei giocatori ancora disponibili.`;
    const rosterWarningKey = auction.rosterWarning
      ? [
          auction.code,
          player.id,
          player.highestBid?.amount || 0,
          auction.rosterWarning.participantName,
          auction.rosterWarning.remainingCredits,
          auction.rosterWarning.minimumRequiredCredits,
        ].join(":")
      : null;
    activeRosterWarningKey = rosterWarningKey;
    if (!rosterWarningKey) dismissedRosterWarningKey = null;
    const sharedWarning =
      rosterWarningKey && dismissedRosterWarningKey !== rosterWarningKey
        ? `<div class="shared-roster-warning" role="alert"><i class="warning-icon" data-lucide="triangle-alert"></i><p><strong>Attenzione per ${auction.rosterWarning.participantName}</strong>Dopo questa offerta restano ${money(auction.rosterWarning.remainingCredits)}. ${warningDetails}</p><button id="dismissRosterWarning" aria-label="Chiudi avviso"><i data-lucide="x"></i></button></div>`
        : "";
    return `${sharedWarning}<div class="live-layout"><div class="live-main"><div class="live-status-row"><span class="auction-status ${auction.status === "live" ? "live" : "paused"}"><i></i>${auction.status === "live" ? "Asta in corso" : "Asta in pausa"}</span></div><div class="countdown-slot"></div><div class="auction-grid"><article class="player-card"><div class="player-hero"><span class="role">${player.role}</span><span class="tier">★ Fascia ${player.tier}</span><strong>${player.number || initials(player.name)}</strong><div class="role-art role-${player.role.toLowerCase()}">${roleArtwork}</div></div><div class="player-name"><h2>${player.name}</h2><span class="mobile-player-meta">${player.role} · Fascia ${player.tier}</span><div class="player-details"><p>${player.team} · ${player.nation}</p><span class="player-quote">Quotazione <b>${Number.isFinite(+player.quote) ? player.quote : 0}</b></span></div></div><div class="bid-info"><div><small>OFFERTA ATTUALE</small><b class="current-bid">${money(player.highestBid?.amount || 0)}</b></div><div><small>ULTIMA PUNTATA VALIDA</small><p>${lastBidder}</p></div></div></article>${side}</div></div><section class="auction-sidebar">${activity}</section></div>`;
  }

  return { dismissRosterWarning, render };
}
