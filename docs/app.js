const appUrl = "https://fantasybid.onrender.com";
const healthUrl = `${appUrl}/health`;
const retryDelay = 3000;
const requestTimeout = 10000;

const status = document.querySelector("#status");
const waitingMessages = [
  "Nel frattempo, prepara la lista dei giocatori.",
  "Fai due palleggi, al resto pensiamo noi.",
  "Ripassa i tuoi colpi segreti per l'asta.",
  "Controlla il budget: i crediti finiscono in fretta.",
  "Scalda la voce per il prossimo rilancio.",
  "Prometti di non spendere tutto per un solo giocatore.",
];

let checking = false;
let timer;
let messageIndex = 0;

const messageTimer = setInterval(() => {
  messageIndex = (messageIndex + 1) % waitingMessages.length;
  status.textContent = waitingMessages[messageIndex];
}, 3500);

function destinationUrl() {
  const params = new URLSearchParams(location.search);
  const auctionCode = params.get("auction");
  const destination = new URL(appUrl);
  if (auctionCode && /^[a-z0-9]{6}$/i.test(auctionCode)) {
    destination.pathname = `/${auctionCode.toUpperCase()}`;
  }
  destination.hash = location.hash;
  return destination.href;
}

async function checkServer() {
  if (checking) return;
  checking = true;
  clearTimeout(timer);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeout);

  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    if (health.status !== "ready") throw new Error("Server non pronto");

    clearInterval(messageTimer);
    status.textContent = "Il server è pronto. Ti portiamo all'asta…";
    location.replace(destinationUrl());
    return;
  } catch {
    // Il messaggio di attesa continua a cambiare mentre il server si avvia.
  } finally {
    clearTimeout(timeout);
    checking = false;
  }

  timer = setTimeout(checkServer, retryDelay);
}

checkServer();
