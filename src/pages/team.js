import { money } from "../ui.js";

export function renderTeamPage({ auction, participant, sessionName }) {
  const players = participant.players || [];
  return `<div class="title-row"><div><p class="eyebrow">${sessionName.toUpperCase()}</p><h1>La mia <em>rosa.</em></h1></div><button id="exportTeam" class="ghost"><i data-lucide="download"></i> Esporta CSV</button></div><div class="stats"><div><small>CREDITI RESIDUI</small><b>${money(participant.budget - (participant.committed || 0))}</b></div><div><small>GIOCATORI ACQUISTATI</small><b>${players.length} <i>/ ${auction.totalSlots}</i></b></div><div><small>CREDITI SPESI</small><b>${money(participant.committed || 0)}</b></div></div><div class="table"><div class="thead"><span>GIOCATORE</span><span>RUOLO</span><span>SQUADRA</span><span>ACQUISTO</span></div>${players.map((player) => `<div><b>${player.name}</b><span>${player.role}</span><span>${player.team}</span><em>${money(player.price)}</em></div>`).join("") || '<p class="muted pad">Nessun giocatore acquistato.</p>'}</div>`;
}
