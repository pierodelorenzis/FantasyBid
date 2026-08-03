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
  await page.locator(".current-bid").waitFor();

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
  assert.equal(pushedEvent.auction.currentPlayer.highestBid.amount, minimum);
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
    1,
    "Il frontend sta ancora interrogando lo snapshot periodicamente",
  );
  console.log("SSE live update test: OK");
} finally {
  stream?.close();
  await browser?.close();
  server.kill("SIGTERM");
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
