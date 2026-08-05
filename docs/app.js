const appUrl = "https://fantasybid.onrender.com";
const healthUrl = `${appUrl}/health`;
const retryDelay = 3000;
const requestTimeout = 10000;

const status = document.querySelector("#status");
const attempts = document.querySelector("#attempts");
const retry = document.querySelector("#retry");
const continueLink = document.querySelector("#continue");

let attempt = 0;
let checking = false;
let timer;

continueLink.href = appUrl;

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
  retry.hidden = true;
  attempt += 1;
  attempts.textContent = `Tentativo di connessione ${attempt}…`;

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

    status.textContent = "Il server è pronto. Ti portiamo all'asta…";
    attempts.textContent = "Connessione riuscita";
    location.replace(destinationUrl());
    return;
  } catch {
    status.textContent =
      "Il server si sta ancora avviando. La pagina riproverà automaticamente.";
    attempts.textContent = `Prossimo tentativo tra ${retryDelay / 1000} secondi`;
    if (attempt >= 10) retry.hidden = false;
  } finally {
    clearTimeout(timeout);
    checking = false;
  }

  timer = setTimeout(checkServer, retryDelay);
}

retry.addEventListener("click", checkServer);
checkServer();
