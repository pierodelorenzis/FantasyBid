import { api } from "./api.js";

export function createAuctionRealtime({ getSession, onAuction, onInvalid }) {
  let pollingTimer = null;
  let eventSource = null;

  async function refreshAuction() {
    const session = getSession();
    const auction = await api(
      "/auctions/" + session.code + "?token=" + session.token,
    );
    onAuction(auction);
  }

  function startFallbackPolling() {
    if (pollingTimer) return;
    pollingTimer = setInterval(async () => {
      try {
        await refreshAuction();
      } catch {}
    }, 30000);
  }

  function start() {
    const session = getSession();
    eventSource = new EventSource(
      `/api/auctions/${encodeURIComponent(session.code)}/events?token=${encodeURIComponent(session.token)}`,
    );
    eventSource.addEventListener("auction", (event) => {
      try {
        const update = JSON.parse(event.data);
        onAuction(update.auction);
      } catch {}
    });
    eventSource.addEventListener("session-invalid", onInvalid);
    eventSource.onopen = () => {
      clearInterval(pollingTimer);
      pollingTimer = null;
    };
    eventSource.onerror = startFallbackPolling;
  }

  function stop() {
    clearInterval(pollingTimer);
    pollingTimer = null;
    eventSource?.close();
    eventSource = null;
  }

  return { refreshAuction, start, stop };
}
