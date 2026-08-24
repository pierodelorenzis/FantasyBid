import { api } from "../api.js";
import { $, renderIcons, toast } from "../ui.js";

let activeCountdownTimer = null;

export function wireAuctionSession({ auction, session, setAuction, renderLive }) {
  showCountdown(auction);
  const close = $("#closePlayer");
  if (!close) return;
  const toggle = document.createElement("button");
  const countdown = document.createElement("button");
  const actionRow = document.createElement("div");
  const starting = !!auction.startCountdownEndsAt;
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
  countdown.disabled = auction.status !== "live" || !!auction.countdownEndsAt;
  actionRow.className = "admin-action-row";
  actionRow.append(countdown, toggle);
  close.before(actionRow);

  const runAction = async (action) => {
    try {
      const response = await api(`/auctions/${session.code}/${action}`, {
        method: "POST",
        body: JSON.stringify({ token: session.token }),
      });
      setAuction(response.auction);
      renderLive();
      toast(
        action === "close"
          ? "Giocatore assegnato"
          : action === "countdown"
            ? "Countdown avviato"
            : "Stato asta aggiornato",
      );
    } catch (error) {
      toast(error.message);
    }
  };
  toggle.onclick = () => runAction("toggle");
  countdown.onclick = () => runAction("countdown");
  close.textContent = "Assegna e chiama il prossimo";
  close.onclick = () => runAction("close");
  renderCallPanel({ auction, session, setAuction, renderLive });
}

function renderCallPanel({ auction, session, setAuction, renderLive }) {
  const panel = document.createElement("section");
  panel.className = "admin-card live-caller";
  const roles = {
    POR: "Portieri",
    DIF: "Difensori",
    CEN: "Centrocampisti",
    ATT: "Attaccanti",
  };
  panel.innerHTML = `<h2>Chiama un giocatore</h2><p>Seleziona il prossimo nome: i giocatori sono ordinati alfabeticamente per ruolo.</p><div class="caller-groups">${Object.entries(roles).map(([role, label]) => { const list = auction.players.filter((player) => player.role === role).sort((first, second) => first.name.localeCompare(second.name, "it")); return `<section><h3>${label} <small>${list.length}</small></h3>${list.map((player) => { const completed = auction.players.indexOf(player) < auction.currentIndex; const assigned = completed && !!player.highestBid; return `<button class="caller-player ${player.id === auction.currentPlayer?.id ? "current" : ""} ${assigned ? "assigned" : ""} ${completed && !assigned ? "called" : ""}" ${completed ? "disabled" : `data-call-player="${player.id}"`}><span>${player.name}</span><small>${player.team || "—"}${(auction.tierSettings || []).some((tier) => !tier.implicit) ? ` · Fascia ${player.tier}` : ""} · Qt. ${Number.isFinite(+player.quote) ? player.quote : 0}${assigned ? ` · Assegnato a ${player.highestBid.participantName}` : completed ? " · Non assegnato" : ""}</small></button>`; }).join("") || '<p class="muted">Nessun giocatore disponibile.</p>'}</section>`; }).join("")}</div>`;
  panel.querySelectorAll("[data-call-player]").forEach(
    (button) =>
      (button.onclick = async () => {
        button.disabled = true;
        try {
          const response = await api(
            `/auctions/${session.code}/call/${button.dataset.callPlayer}`,
            { method: "POST", body: JSON.stringify({ token: session.token }) },
          );
          setAuction(response.auction);
          renderLive();
          toast("Giocatore chiamato");
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        }
      }),
  );
  $(".auction-grid").after(panel);
}

function showCountdown(auction) {
  clearInterval(activeCountdownTimer);
  activeCountdownTimer = null;
  const end =
    auction.countdownEndsAt ||
    auction.startCountdownEndsAt ||
    auction.bidCountdownEndsAt;
  if (!end || end <= Date.now()) return;
  const starting = !!auction.startCountdownEndsAt;
  const lastCall = !!auction.countdownEndsAt;
  const banner = document.createElement("div");
  banner.className =
    "auction-countdown" +
    (starting ? " starting" : lastCall ? " last-call" : " bidding");
  banner.innerHTML = starting
    ? '<i data-lucide="play"></i> Asta al via tra <strong>0</strong> secondi'
    : lastCall
      ? '<i data-lucide="timer"></i> Giocatore assegnato tra <strong>0</strong> secondi'
      : '<i data-lucide="timer"></i> Tempo per puntare: <strong>0</strong> secondi';
  $(".countdown-slot").append(banner);
  renderIcons();
  const counter = banner.querySelector("strong");
  const visibleDuration = starting || lastCall
    ? 5000
    : (auction.bidDurationSeconds || 30) * 1000;
  const startsAt = end - visibleDuration;
  const update = () => {
    const countdownNow = Math.max(Date.now(), startsAt);
    const seconds = Math.max(0, Math.ceil((end - countdownNow) / 1000));
    counter.textContent = seconds;
    if (!seconds) {
      clearInterval(activeCountdownTimer);
      activeCountdownTimer = null;
      banner.remove();
    }
  };
  update();
  if (banner.isConnected) activeCountdownTimer = setInterval(update, 200);
}
