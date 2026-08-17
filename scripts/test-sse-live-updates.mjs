import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = await fs.mkdtemp(
  path.join(os.tmpdir(), "fantabid-sse-"),
);
const storePath = path.join(temporaryDirectory, "data.json");
const source = JSON.parse(await fs.readFile(path.join(root, "data.json")));
const auction = Object.values(source.auctions).find(
  (item) =>
    item.players?.length >= 2 &&
    item.participants?.filter((participant) => participant.role === "participant")
      .length >= 2,
);
assert(auction, "Serve un'asta con almeno un giocatore e due partecipanti");

auction.status = "live";
auction.currentIndex = 0;
delete auction.players[0].highestBid;
delete auction.players[1].highestBid;
auction.countdownEndsAt = null;
auction.startCountdownEndsAt = null;
auction.activity = [];
auction.participants.forEach((participant) => {
  participant.committed = 0;
  participant.budget = Math.max(participant.budget || 0, 500);
});
await fs.writeFile(
  storePath,
  JSON.stringify({ auctions: { [auction.code]: auction } }),
);

const port = 32000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    FANTABID_STORE_PATH: storePath,
    SUPABASE_URL: "",
    SUPABASE_SECRET_KEY: "",
    USE_ATOMIC_BID: "false",
    OWNER_DASHBOARD_TOKEN: "test-owner-token",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("Il server di test non si è avviato");
}

function connectSse(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(Error(`SSE ha risposto ${response.statusCode}`));
        return;
      }
      let buffer = "";
      const queue = [];
      const waiters = [];
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          if (!data) continue;
          const event = JSON.parse(data);
          const waiter = waiters.shift();
          if (waiter) waiter(event);
          else queue.push(event);
        }
      });
      resolve({
        next: () =>
          queue.length
            ? Promise.resolve(queue.shift())
            : new Promise((nextResolve) => waiters.push(nextResolve)),
        close: () => request.destroy(),
      });
    });
    request.on("error", reject);
  });
}

function overlaps(first, second) {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

let browser;
let stream;
try {
  await waitForServer();
  const participants = auction.participants.filter(
    (participant) => participant.role === "participant",
  );
  const browserParticipant = participants[0];
  const bidder = participants[1];
  const administrator = auction.participants.find(
    (participant) => participant.role === "admin",
  );
  assert(administrator, "Serve un amministratore per chiudere la puntata");
  const minimum = auction.rules[auction.players[0].tier].minPrice;
  const nextMinimum = auction.rules[auction.players[1].tier].minPrice;

  stream = await connectSse(
    `${baseUrl}/api/auctions/${auction.code}/events?token=${browserParticipant.token}`,
  );
  const initialEvent = await stream.next();
  assert.equal(initialEvent.auction.currentPlayer.highestBid, undefined);

  browser = await chromium.launch({ headless: true });
  const creationContext = await browser.newContext();
  await creationContext.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__copiedAdminLink = value;
        },
      },
    });
  });
  const creationPage = await creationContext.newPage();
  await creationPage.goto(baseUrl, { waitUntil: "networkidle" });
  await creationPage.locator("#appVersion").waitFor();
  assert.equal(await creationPage.locator("#appVersion").textContent(), "v1.0.1");
  assert.equal(
    await creationPage.locator("#appVersion").evaluate(
      (element) => getComputedStyle(element).fontSize,
    ),
    "9px",
  );
  assert.equal(
    await creationPage.locator(".landing-credit > span").textContent(),
    "Made with love by Pedro.",
  );
  const tipLink = creationPage.locator(".tip-link");
  assert.equal(
    await tipLink.getAttribute("href"),
    "https://www.paypal.me/pierodelorenzis",
  );
  assert.equal(await tipLink.getAttribute("target"), "_blank");
  assert.match(await tipLink.getAttribute("rel"), /noopener/);
  await creationPage.locator("#showCreate").click();
  await creationPage.locator('#create [name="name"]').fill("Lega popup test");
  await creationPage.locator('#create [name="adminName"]').fill("Admin popup");
  await creationPage.locator("#create button.primary").click();
  await creationPage.locator("#adminLinkTitle").waitFor();
  assert.match(
    await creationPage.locator(".confirm-card").textContent(),
    /Gestione asta.*Link di accesso/s,
  );
  assert.match(
    await creationPage.locator(".confirm-card").textContent(),
    /senza il link amministratore.*non sarà più possibile accedere/s,
  );
  await creationPage.locator("[data-copy-admin]").click();
  const copiedCreationLink = await creationPage.evaluate(
    () => window.__copiedAdminLink,
  );
  assert.match(copiedCreationLink, /#[^#]*admin=/);
  await creationPage.locator("[data-continue]").click();
  await creationPage.locator(".shell").waitFor();
  await creationPage.locator('[data-page="admin"]').click();
  await creationPage.locator("#playerFile").setInputFiles({
    name: "catalogo-test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Nome,Ruolo,Squadra,Quotazione\nPortiere Test,POR,Test FC,10\nAttaccante Test,ATT,Test FC,20\n",
    ),
  });
  await creationPage.locator("[data-confirm]").click();
  await creationPage.waitForFunction(() =>
    document.querySelector(".catalog-heading")?.textContent.includes("2 importati"),
  );
  await creationContext.close();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminPage.goto(
    `${baseUrl}/${auction.code}#admin=${encodeURIComponent(administrator.token)}`,
    { waitUntil: "networkidle" },
  );
  assert.equal(new URL(adminPage.url()).pathname, `/${auction.code}`);
  assert.equal(new URL(adminPage.url()).hash, "");
  const recoveredAdminSession = await adminPage.evaluate(
    (code) => JSON.parse(localStorage.getItem("fantabid-sessions"))[code],
    auction.code,
  );
  assert.equal(recoveredAdminSession.role, "admin");
  assert.equal(recoveredAdminSession.token, administrator.token);

  const invalidAccess = await fetch(
    `${baseUrl}/api/auctions/${auction.code}/access`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "invalid-admin-token" }),
    },
  );
  assert.equal(invalidAccess.status, 400);

  const participantRotation = await fetch(
    `${baseUrl}/api/auctions/${auction.code}/admin-link`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: browserParticipant.token }),
    },
  );
  assert.equal(participantRotation.status, 400);

  await adminPage.locator('[data-page="admin"]').click();
  const initialTierRows = await adminPage.locator(".tier-row").count();
  await adminPage.locator("#addTier").click();
  assert.equal(await adminPage.locator(".tier-row").count(), initialTierRows + 1);
  await adminPage.locator(".tier-row .remove-tier").last().click();
  assert.equal(await adminPage.locator(".tier-row").count(), initialTierRows);
  await adminPage.locator("#rotateAdminLink").click();
  await adminPage.locator("[data-confirm]").click();
  await adminPage.waitForFunction(
    ({ code, previousToken }) =>
      JSON.parse(localStorage.getItem("fantabid-sessions"))[code]?.token !==
      previousToken,
    { code: auction.code, previousToken: administrator.token },
  );
  await adminPage.locator("#rotateAdminLink").waitFor();
  const rotatedAdminLink = await adminPage.evaluate((code) => {
    const recovered = JSON.parse(localStorage.getItem("fantabid-sessions"))[code];
    return { code, token: recovered.token };
  }, auction.code);
  assert.notEqual(rotatedAdminLink.token, administrator.token);
  const rotationEvent = await stream.next();
  assert.equal(rotationEvent.auction.code, auction.code);
  await adminPage.locator("#rotateAdminLink").waitFor();
  await adminContext.close();

  const expiredAdminAccess = await fetch(
    `${baseUrl}/api/auctions/${auction.code}/access`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: administrator.token }),
    },
  );
  assert.equal(expiredAdminAccess.status, 400);
  administrator.token = rotatedAdminLink.token;
  const rotatedAdminAccess = await fetch(
    `${baseUrl}/api/auctions/${auction.code}/access`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: administrator.token }),
    },
  );
  assert.equal(rotatedAdminAccess.status, 200);

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(() =>
    sessionStorage.setItem("fantabid-owner-token", "test-owner-token"),
  );
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${baseUrl}/?owner`, { waitUntil: "networkidle" });
  await ownerPage.locator(".owner-table").waitFor();
  assert.equal(
    await ownerPage.locator("[data-owner-copy-admin], [data-owner-rotate-admin]").count(),
    0,
  );
  const ownerAdminLinkResponse = await fetch(
    `${baseUrl}/api/owner/auctions/${auction.code}/admin-link`,
    { headers: { "x-owner-token": "test-owner-token" } },
  );
  assert.equal(ownerAdminLinkResponse.status, 400);
  await ownerContext.close();

  const context = await browser.newContext();
  await context.addInitScript(
    ({ code, token, name }) =>
      localStorage.setItem(
        "fantabid-session",
        JSON.stringify({ code, token, name, role: "participant" }),
      ),
    {
      code: auction.code,
      token: browserParticipant.token,
      name: browserParticipant.name,
    },
  );
  const page = await context.newPage();
  let snapshotRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === `/api/auctions/${auction.code}`
    )
      snapshotRequests += 1;
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#showCreate").waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(
    snapshotRequests,
    0,
    "La homepage non deve riaprire automaticamente l'ultima asta",
  );

  await page.goto(`${baseUrl}/${auction.code}`, { waitUntil: "networkidle" });
  await page.locator(".current-bid").waitFor();
  assert.equal(new URL(page.url()).pathname, `/${auction.code}`);
  const migratedSessions = await page.evaluate(() => ({
    legacy: localStorage.getItem("fantabid-session"),
    sessions: JSON.parse(localStorage.getItem("fantabid-sessions")),
  }));
  assert.equal(migratedSessions.legacy, null);
  assert.equal(migratedSessions.sessions[auction.code].token, browserParticipant.token);

  await page.evaluate(() => {
    const sessions = JSON.parse(localStorage.getItem("fantabid-sessions"));
    sessions.ZZZ999 = {
      code: "ZZZ999",
      token: "other-session-token",
      role: "admin",
      name: "Altro admin",
    };
    localStorage.setItem("fantabid-sessions", JSON.stringify(sessions));
  });
  const separateSessions = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fantabid-sessions")),
  );
  assert.equal(separateSessions[auction.code].token, browserParticipant.token);
  assert.equal(separateSessions.ZZZ999.token, "other-session-token");

  await page.goto(`${baseUrl}/${auction.code}`, { waitUntil: "networkidle" });
  await page.locator(".current-bid").waitFor();
  const snapshotRequestsAfterNavigation = snapshotRequests;

  await page.setViewportSize({ width: 1440, height: 900 });
  const wideMain = await page.locator(".live-main").boundingBox();
  const wideSidebar = await page.locator(".auction-sidebar").boundingBox();
  assert(wideMain && wideSidebar && !overlaps(wideMain, wideSidebar));
  assert(
    wideSidebar.x > wideMain.x,
    "Su desktop largo i movimenti devono restare a destra",
  );

  await page.setViewportSize({ width: 1200, height: 900 });
  const mediumGrid = await page.locator(".auction-grid").boundingBox();
  const mediumSidebar = await page.locator(".auction-sidebar").boundingBox();
  assert(mediumGrid && mediumSidebar && !overlaps(mediumGrid, mediumSidebar));
  assert(
    mediumSidebar.y >= mediumGrid.y + mediumGrid.height,
    "Su desktop stretto i movimenti devono essere sotto le card",
  );

  await page.setViewportSize({ width: 900, height: 900 });
  const narrowCards = await page.locator(".auction-grid > *").all();
  assert.equal(narrowCards.length, 2);
  const narrowFirst = await narrowCards[0].boundingBox();
  const narrowSecond = await narrowCards[1].boundingBox();
  const narrowSidebar = await page.locator(".auction-sidebar").boundingBox();
  assert(
    narrowFirst &&
      narrowSecond &&
      narrowSidebar &&
      !overlaps(narrowFirst, narrowSecond) &&
      narrowSecond.y >= narrowFirst.y + narrowFirst.height &&
      narrowSidebar.y >= narrowSecond.y + narrowSecond.height,
    "Su desktop molto stretto tutte le card devono disporsi in colonna",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).touchAction,
    ),
    "manipulation",
    "Il doppio tap deve essere disattivato nel layout mobile",
  );
  const touchButtons = await page.evaluate(() => {
    const plus = document.querySelector("#plus");
    const initialAmount = Number(document.querySelector("#amount").value);
    const firstAccepted = plus.dispatchEvent(
      new Event("touchend", { bubbles: true, cancelable: true }),
    );
    const secondAccepted = plus.dispatchEvent(
      new Event("touchend", { bubbles: true, cancelable: true }),
    );
    return {
      touchAction: getComputedStyle(plus).touchAction,
      firstAccepted,
      secondAccepted,
      amount: Number(document.querySelector("#amount").value),
      initialAmount,
    };
  });
  assert.equal(touchButtons.touchAction, "manipulation");
  assert.equal(touchButtons.firstAccepted, false);
  assert.equal(touchButtons.secondAccepted, false);
  assert.equal(touchButtons.amount, touchButtons.initialAmount + 2);

  const bidStartedAt = performance.now();
  const bidResponse = await fetch(
    `${baseUrl}/api/auctions/${auction.code}/bid`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: bidder.token, amount: minimum }),
    },
  );
  assert.equal(bidResponse.status, 200);

  const pushedEvent = await stream.next();
  const bidRealtimeLatency = performance.now() - bidStartedAt;
  assert.equal(pushedEvent.auction.currentPlayer.highestBid.amount, minimum);
  assert(
    bidRealtimeLatency < 2000,
    `Aggiornamento puntata troppo lento: ${Math.round(bidRealtimeLatency)} ms`,
  );
  await page.waitForFunction(
    (expected) =>
      document.querySelector(".current-bid")?.textContent.includes(String(expected)),
    minimum,
  );
  await page.locator("#amount").fill(String(minimum + 77));

  const closeResponse = await fetch(
    `${baseUrl}/api/auctions/${auction.code}/close`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: administrator.token }),
    },
  );
  assert.equal(closeResponse.status, 200);
  const nextPlayerEvent = await stream.next();
  assert.equal(nextPlayerEvent.auction.currentPlayer.id, auction.players[1].id);
  const teamStyleContext = await browser.newContext();
  const teamStylePage = await teamStyleContext.newPage();
  await teamStylePage.goto(
    `${baseUrl}/${auction.code}#admin=${encodeURIComponent(administrator.token)}`,
    { waitUntil: "networkidle" },
  );
  await teamStylePage.locator('[data-page="teams"]').click();
  const removePlayerButton = teamStylePage.locator(".remove-team-player").first();
  await removePlayerButton.waitFor();
  const removePlayerStyle = await removePlayerButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      color: style.color,
      display: style.display,
      justifyContent: style.justifyContent,
      textAlign: style.textAlign,
    };
  });
  assert.equal(removePlayerStyle.background, "rgb(255, 240, 236)");
  assert.equal(removePlayerStyle.color, "rgb(214, 84, 43)");
  assert.equal(removePlayerStyle.display, "flex");
  assert.equal(removePlayerStyle.justifyContent, "center");
  assert.equal(removePlayerStyle.textAlign, "center");
  await teamStylePage
    .locator(`.edit-credits[data-participant="${bidder.token}"]`)
    .click();
  await teamStylePage.locator('[name="budget"]').fill("505");
  await teamStylePage.locator(".confirm-card form button.primary").click();
  await teamStylePage.locator(".confirm-modal").waitFor({ state: "detached" });
  await teamStylePage
    .locator(`.remove-team-player[data-participant="${bidder.token}"]`)
    .first()
    .click();
  await teamStylePage.locator("[data-confirm]").click();
  await teamStylePage.waitForFunction(
    (participantToken) =>
      !document.querySelector(
        `.remove-team-player[data-participant="${participantToken}"]`,
      ),
    bidder.token,
  );
  const teamManagementSnapshot = await fetch(
    `${baseUrl}/api/auctions/${auction.code}?token=${administrator.token}`,
  ).then((response) => response.json());
  const managedBidder = teamManagementSnapshot.participants.find(
    (participant) => participant.token === bidder.token,
  );
  assert.equal(managedBidder.players.length, 0);
  assert.equal(managedBidder.budget, bidder.budget + 5);
  await teamStyleContext.close();
  await page.waitForFunction(
    ({ playerName, amount }) =>
      document.querySelector(".player-name h2")?.textContent === playerName &&
      document.querySelector("#amount")?.value === String(amount),
    { playerName: auction.players[1].name, amount: nextMinimum },
  );
  assert.equal(await page.locator("#amount").inputValue(), String(nextMinimum));
  await page.waitForTimeout(2200);
  assert.equal(
    snapshotRequests,
    snapshotRequestsAfterNavigation,
    "Il frontend sta ancora interrogando lo snapshot periodicamente",
  );
  const clearActivityResponse = await fetch(
    `${baseUrl}/api/auctions/${auction.code}/clear-activity`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: administrator.token }),
    },
  );
  assert.equal(clearActivityResponse.status, 200);
  const clearedAuction = await clearActivityResponse.json();
  assert(
    clearedAuction.auction.participants.every(
      (participant) =>
        participant.budget === auction.budget && participant.committed === 0,
    ),
    "La cancellazione dei movimenti deve ripristinare i crediti iniziali",
  );
  console.log("SSE live update test: OK");
} finally {
  stream?.close();
  await browser?.close();
  server.kill("SIGTERM");
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
