import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(fileURLToPath(import.meta.url));
const store = path.join(root, "data.json");
const players = [
  ["Mateo Retegui", "ATT", "Atalanta", "Italia", "A", 9, 30],
  ["Lautaro Martínez", "ATT", "Inter", "Argentina", "A", 10, 35],
  ["Teun Koopmeiners", "CEN", "Juventus", "Olanda", "A", 8, 25],
  ["Riccardo Orsolini", "CEN", "Bologna", "Italia", "B", 7, 15],
  ["Gleison Bremer", "DIF", "Juventus", "Brasile", "A", 3, 22],
  ["Alessandro Buongiorno", "DIF", "Napoli", "Italia", "B", 4, 14],
  ["Michele Di Gregorio", "POR", "Juventus", "Italia", "B", 1, 12],
  ["Nicolò Fagioli", "CEN", "Fiorentina", "Italia", "C", 21, 6],
  ["Raoul Bellanova", "DIF", "Atalanta", "Italia", "B", 16, 12],
  ["Moise Kean", "ATT", "Fiorentina", "Italia", "B", 20, 18],
  ["Elia Caprile", "POR", "Cagliari", "Italia", "C", 12, 5],
  ["Matias Soulé", "CEN", "Roma", "Argentina", "B", 18, 16],
];
let db = fs.existsSync(store)
  ? JSON.parse(fs.readFileSync(store))
  : { auctions: {} };
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const ownerDashboardToken = process.env.OWNER_DASHBOARD_TOKEN;
const atomicBidEnabled = process.env.USE_ATOMIC_BID === "true";
const supabase =
  supabaseUrl && supabaseSecretKey
    ? createClient(supabaseUrl, supabaseSecretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
    : null;
const production = process.env.NODE_ENV === "production";
if (production && !supabase)
  throw Error(
    "In produzione sono obbligatorie SUPABASE_URL e SUPABASE_SECRET_KEY",
  );
const auctionVersions = new Map();
const storageReady = (async () => {
  if (!supabase) return;
  try {
    const { data: snapshots, error } = await supabase
      .from("auction_snapshots")
      .select("code, state, version");
    if (error) throw error;
    const remoteAuctions = Object.fromEntries(
      snapshots.map((snapshot) => [snapshot.code, snapshot.state]),
    );
    snapshots.forEach((snapshot) =>
      auctionVersions.set(snapshot.code, snapshot.version),
    );
    if (!snapshots.length && Object.keys(db.auctions).length) {
      console.warn(
        "Supabase non contiene ancora aste: viene mantenuto il backup locale.",
      );
      return;
    }
    db = { auctions: remoteAuctions };
    fs.writeFileSync(store, JSON.stringify(db, null, 2));
    console.log(`Aste caricate da Supabase: ${snapshots.length}`);
  } catch (error) {
    console.error(
      "Impossibile caricare Supabase, viene usato il backup locale:",
      error.message,
    );
    if (production) throw error;
  }
})();
const pendingSupabaseMirror = new Map();
let supabaseMirrorTimer = null;
let supabaseMirrorRunning = false;
function scheduleSupabaseMirror(auctionCode) {
  if (!supabase) return;
  const auction = db.auctions[auctionCode];
  if (!auction) return;
  pendingSupabaseMirror.set(auctionCode, JSON.parse(JSON.stringify(auction)));
  clearTimeout(supabaseMirrorTimer);
  supabaseMirrorTimer = setTimeout(flushSupabaseMirror, 300);
}
async function flushSupabaseMirror() {
  if (supabaseMirrorRunning || !supabase) return;
  supabaseMirrorRunning = true;
  const batch = new Map(pendingSupabaseMirror);
  pendingSupabaseMirror.clear();
  try {
    for (const [code, state] of batch) {
      const version = auctionVersions.get(code);
      if (version === undefined) {
        const { data, error } = await supabase
          .from("auction_snapshots")
          .upsert(
            {
              code,
              state,
              version: 1,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "code" },
          )
          .select("version")
          .single();
        if (error) throw error;
        auctionVersions.set(code, data.version);
        continue;
      }
      const { data, error } = await supabase.rpc("replace_auction_snapshot", {
        p_code: code,
        p_expected_version: version,
        p_state: state,
      });
      if (error) throw error;
      if (!data?.length)
        throw Error(
          `Conflitto di versione per l’asta ${code}: aggiornamento non applicato.`,
        );
      auctionVersions.set(code, data[0].version);
    }
  } catch (error) {
    batch.forEach((state, code) => pendingSupabaseMirror.set(code, state));
    console.error("Replica Supabase non riuscita:", error.message);
  } finally {
    supabaseMirrorRunning = false;
    if (pendingSupabaseMirror.size) {
      clearTimeout(supabaseMirrorTimer);
      supabaseMirrorTimer = setTimeout(flushSupabaseMirror, 1000);
    }
  }
}
function save(auctionCode) {
  fs.writeFileSync(store, JSON.stringify(db, null, 2));
  scheduleSupabaseMirror(auctionCode);
}
async function saveNewAuction(auctionCode) {
  const auction = db.auctions[auctionCode];
  fs.writeFileSync(store, JSON.stringify(db, null, 2));
  if (!supabase) return;
  const { data, error } = atomicBidEnabled
    ? await supabase.rpc("create_auction", { p_state: auction })
    : await supabase
        .from("auction_snapshots")
        .upsert(
          {
            code: auctionCode,
            state: auction,
            version: 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "code" },
        )
        .select("version")
        .single();
  if (error) {
    delete db.auctions[auctionCode];
    fs.writeFileSync(store, JSON.stringify(db, null, 2));
    throw Error(`Impossibile salvare la nuova asta su Supabase: ${error.message}`);
  }
  auctionVersions.set(auctionCode, data.version);
}
async function restoreAuctionFromSupabase(auctionCode) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("auction_snapshots")
    .select("code, state, version")
    .eq("code", auctionCode)
    .maybeSingle();
  if (error) throw Error(error.message);
  if (!data) return null;
  db.auctions[auctionCode] = data.state;
  auctionVersions.set(auctionCode, data.version);
  return data.state;
}
function scheduleAtomicSessionCompletion(
  auction,
  administrator,
  type,
  endsAt,
) {
  const countdownKey =
    type === "start" ? "startCountdownEndsAt" : "countdownEndsAt";
  const action = type === "start" ? "complete_start" : "complete_pause";
  const delay = Math.max(0, endsAt - Date.now()) + 100;
  setTimeout(async () => {
    if (auction[countdownKey] !== endsAt || !supabase) return;
    try {
      const { data, error } = await supabase.rpc("update_auction_session", {
        p_auction_code: auction.code,
        p_admin_token: administrator.token,
        p_action: action,
      });
      if (error) throw error;
      if (auction[countdownKey] !== endsAt) return;
      auction.status = data.status;
      auction[countdownKey] = null;
      const initialPlayer =
        type === "start" && auction.currentIndex === 0
          ? auction.players[auction.currentIndex]
          : null;
      if (
        initialPlayer &&
        !auction.activity.some(
          (entry) => entry.action === "chiama " + initialPlayer.name,
        )
      ) {
        auction.activity.unshift({
          name: administrator.name,
          action: "chiama " + initialPlayer.name,
        });
      }
      auction.activity.unshift({
        name: administrator.name,
        action:
          type === "start" ? "avvia l’asta" : "mette in pausa l’asta",
      });
      save(auction.code);
    } catch (error) {
      console.error(
        `Completamento countdown ${type} non riuscito:`,
        error.message,
      );
    }
  }, delay);
}
storageReady.then(() => {
  if (!atomicBidEnabled || !supabase) return;
  Object.values(db.auctions).forEach((auction) => {
    const administrator = auction.participants.find(
      (participant) => participant.role === "admin",
    );
    if (!administrator) return;
    if (auction.startCountdownEndsAt)
      scheduleAtomicSessionCompletion(
        auction,
        administrator,
        "start",
        auction.startCountdownEndsAt,
      );
    if (auction.countdownEndsAt)
      scheduleAtomicSessionCompletion(
        auction,
        administrator,
        "pause",
        auction.countdownEndsAt,
      );
  });
});
storageReady.catch((error) => {
  if (!production) return;
  console.error("Avvio annullato: Supabase non è raggiungibile.", error.message);
  process.exit(1);
});
const id = () => randomBytes(14).toString("hex");
const code = () => randomBytes(3).toString("hex").toUpperCase();
const json = (res, value, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};
const read = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Error("JSON non valido"));
      }
    });
  });
const publicAuction = (auction, requester) => {
  const requesterParticipant = own(auction, requester);
  const requesterIsAdmin = requesterParticipant?.role === "admin";
  const currentPlayer = auction.players[auction.currentIndex] || null;
  const canBid = Boolean(
    requesterParticipant?.role === "participant" &&
      currentPlayer &&
      auction.status === "live" &&
      currentPlayer.highestBid?.participantToken !== requesterParticipant.token,
  );
  const { history, ...auctionData } = auction;
  return {
    ...auctionData,
    canUndo: requesterIsAdmin && Boolean(history?.length),
    currentPlayer,
    canBid,
    participants: auction.participants.map(({ token, ...participant }) =>
      requesterIsAdmin || token === requester
        ? { ...participant, token }
        : participant,
    ),
  };
};
const own = (auction, token) =>
  auction.participants.find((participant) => participant.token === token);
function requireAdmin(auction, token) {
  const participant = own(auction, token);
  if (!participant || participant.role !== "admin")
    throw Error("Operazione riservata all’admin");
  return participant;
}
function requireOwner(req) {
  if (!ownerDashboardToken)
    throw Error("Area proprietario non configurata sul server");
  if (req.headers["x-owner-token"] !== ownerDashboardToken)
    throw Error("Accesso proprietario non autorizzato");
}
function ownerAuctionSummary(auction, metadata = {}) {
  const participants = auction.participants || [];
  const assigned = participants.reduce(
    (total, participant) => total + (participant.players || []).length,
    0,
  );
  return {
    code: auction.code,
    name: auction.name || "Asta senza nome",
    status: auction.status || "paused",
    participants: participants.filter((participant) => participant.role === "participant")
      .length,
    players: (auction.players || []).length,
    assigned,
    currentPlayer: auction.players?.[auction.currentIndex]?.name || null,
    activityCount: (auction.activity || []).length,
    createdAt: metadata.created_at || null,
    updatedAt: metadata.updated_at || null,
  };
}
function calculate(participant) {
  participant.committed = participant.players.reduce(
    (total, player) => total + player.price,
    0,
  );
}
function rememberState(auction) {
  const { history, ...snapshot } = auction;
  auction.history ||= [];
  auction.history.push(JSON.parse(JSON.stringify(snapshot)));
  if (auction.history.length > 20) auction.history.shift();
}
const defaultTierSettings = () => [
  { name: "A", minQuote: 20, minPrice: 20, increment: 3, cap: 150 },
  { name: "B", minQuote: 8, minPrice: 8, increment: 2, cap: 100 },
  { name: "C", minQuote: 0, minPrice: 1, increment: 1, cap: 50 },
];
function ensureTierSettings(auction) {
  if (!auction.tierSettings?.length) {
    auction.tierSettings = defaultTierSettings().map((tier) => ({
      ...tier,
      ...(auction.rules[tier.name] || {}),
    }));
  }
  auction.tierSettings.sort((a, b) => b.minQuote - a.minQuote);
  auction.rules = Object.fromEntries(
    auction.tierSettings.map((tier) => [
      tier.name,
      {
        minPrice: +tier.minPrice,
        increment: +tier.increment,
        cap: +tier.cap,
      },
    ]),
  );
}
function recalculateTiers(auction) {
  ensureTierSettings(auction);
  auction.players.forEach((player) => {
    const quote = Number(player.quote) || 0;
    player.tier =
      auction.tierSettings.find((tier) => quote >= tier.minQuote)?.name ||
      auction.tierSettings.at(-1).name;
  });
}
function minimumCompletionCost(auction, slotsToFill) {
  const minimumPrices = auction.players
    .slice(auction.currentIndex + 1)
    .map((player) => auction.rules[player.tier]?.minPrice ?? 0)
    .sort((first, second) => first - second);
  if (minimumPrices.length < slotsToFill) return Infinity;
  return minimumPrices
    .slice(0, slotsToFill)
    .reduce((total, price) => total + price, 0);
}
function normalizeRole(value) {
  const role = String(value || "")
    .trim()
    .toUpperCase();
  return {
    POR: "POR",
    P: "POR",
    PORTIERE: "POR",
    PORTIERI: "POR",
    DIF: "DIF",
    D: "DIF",
    DIFENSORE: "DIF",
    DIFENSORI: "DIF",
    CEN: "CEN",
    C: "CEN",
    M: "CEN",
    CENTROCAMPISTA: "CEN",
    CENTROCAMPISTI: "CEN",
    ATT: "ATT",
    A: "ATT",
    ATTACCANTE: "ATT",
    ATTACCANTI: "ATT",
  }[role];
}
function serveFile(res, requested) {
  const safe = path.normalize(path.join(root, requested));
  if (!safe.startsWith(root) || !fs.existsSync(safe)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const type =
    {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    }[
      path.extname(safe)
    ] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store, max-age=0",
  });
  fs.createReadStream(safe).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const bits = url.pathname.split("/").filter(Boolean);
    const body = ["POST", "PUT", "DELETE"].includes(req.method)
      ? await read(req)
      : {};
    if (!bits[0]) return serveFile(res, "index.html");
    if (bits[0] !== "api") return serveFile(res, bits.join("/"));
    await storageReady;

    if (bits[1] === "owner" && bits[2] === "auctions") {
      requireOwner(req);
      if (req.method === "GET") {
        let summaries;
        if (supabase) {
          const { data: snapshots, error } = await supabase
            .from("auction_snapshots")
            .select("code, state, created_at, updated_at")
            .order("updated_at", { ascending: false });
          if (error) throw Error(error.message);
          summaries = snapshots.map((snapshot) =>
            ownerAuctionSummary(snapshot.state, snapshot),
          );
        } else {
          summaries = Object.values(db.auctions).map((auction) =>
            ownerAuctionSummary(auction),
          );
        }
        return json(res, { auctions: summaries });
      }
      if (req.method === "DELETE") {
        if (body.confirmation !== "ELIMINA TUTTE LE ASTE")
          throw Error("Conferma di eliminazione non valida");
        if (!supabase)
          throw Error("La cancellazione globale richiede la connessione a Supabase");
        const { count, error: countError } = await supabase
          .from("auction_snapshots")
          .select("code", { count: "exact", head: true });
        if (countError) throw Error(countError.message);
        const { error: auctionsError } = await supabase
          .from("auctions")
          .delete()
          .neq("code", "");
        if (auctionsError) throw Error(auctionsError.message);
        const { error: snapshotsError } = await supabase
          .from("auction_snapshots")
          .delete()
          .neq("code", "");
        if (snapshotsError) throw Error(snapshotsError.message);
        clearTimeout(supabaseMirrorTimer);
        pendingSupabaseMirror.clear();
        auctionVersions.clear();
        db = { auctions: {} };
        fs.writeFileSync(store, JSON.stringify(db, null, 2));
        return json(res, { deletedCount: count || 0 });
      }
    }

    if (req.method === "POST" && bits[1] === "auctions" && bits.length === 2) {
      let auctionCode;
      do auctionCode = code();
      while (db.auctions[auctionCode]);
      const token = id();
      const auction = {
        code: auctionCode,
        name: body.name,
        budget: +body.budget,
        status: "paused",
        totalSlots: 25,
        remainingSlots: 25,
        rules: {
          A: { minPrice: 20, increment: 3, cap: 150 },
          B: { minPrice: 8, increment: 2, cap: 100 },
          C: { minPrice: 1, increment: 1, cap: 50 },
        },
        tierSettings: defaultTierSettings(),
        players: players.map((player, index) => ({
          id: "p" + index,
          name: player[0],
          role: player[1],
          team: player[2],
          nation: player[3],
          tier: player[4],
          number: player[5],
          quote: player[6],
        })),
        currentIndex: 0,
        playerOrder: null,
        orderByRole: false,
        participants: [
          {
            token,
            name: body.adminName,
            role: "admin",
            budget: +body.budget,
            players: [],
            committed: 0,
          },
        ],
        activity: [],
      };
      db.auctions[auctionCode] = auction;
      await saveNewAuction(auctionCode);
      return json(res, {
        code: auctionCode,
        adminToken: token,
        adminName: body.adminName,
      });
    }
    const auction =
      db.auctions[bits[2]] || (await restoreAuctionFromSupabase(bits[2]));
    if (!auction) throw Error("Asta non trovata");
    ensureTierSettings(auction);
    if (req.method === "GET" && bits.length === 3)
      return json(res, publicAuction(auction, url.searchParams.get("token")));
    if (req.method === "POST" && bits[3] === "join") {
      if (atomicBidEnabled && supabase) {
        const { data, error } = await supabase.rpc("join_auction", {
          p_auction_code: auction.code,
          p_name: String(body.name || ""),
        });
        if (error) throw Error(error.message);
        if (data.created) {
          auction.participants.push({
            token: data.token,
            name: data.name,
            role: "participant",
            budget: auction.budget,
            players: [],
            committed: 0,
          });
          save(auction.code);
        }
        return json(res, { token: data.token });
      }
      let participant = auction.participants.find(
        (item) => item.name.toLowerCase() === String(body.name).toLowerCase(),
      );
      if (!participant) {
        participant = {
          token: id(),
          name: body.name,
          role: "participant",
          budget: auction.budget,
          players: [],
          committed: 0,
        };
        auction.participants.push(participant);
        save(auction.code);
      }
      return json(res, { token: participant.token });
    }
    if (req.method === "POST" && bits[3] === "countdown") {
      const administrator = requireAdmin(auction, body.token);
      if (atomicBidEnabled && supabase) {
        const { data, error } = await supabase.rpc("update_auction_session", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_action: "schedule_pause",
        });
        if (error) throw Error(error.message);
        rememberState(auction);
        auction.countdownEndsAt = data.countdownEndsAt;
        auction.startCountdownEndsAt = null;
        save(auction.code);
        scheduleAtomicSessionCompletion(
          auction,
          administrator,
          "pause",
          data.countdownEndsAt,
        );
        return json(res, { auction: publicAuction(auction, body.token) });
      }
      if (auction.status !== "live") throw Error("L’asta non è attiva");
      if (auction.countdownEndsAt && auction.countdownEndsAt > Date.now())
        throw Error("Countdown già attivo");
      rememberState(auction);
      auction.countdownEndsAt = Date.now() + 5000;
      save(auction.code);
      setTimeout(() => {
        if (auction.countdownEndsAt && auction.countdownEndsAt <= Date.now()) {
          auction.status = "paused";
          auction.countdownEndsAt = null;
          auction.activity.unshift({
            name: administrator.name,
            action: "mette in pausa l’asta",
          });
          save(auction.code);
        }
      }, 5100);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "call" && bits[4]) {
      const administrator = requireAdmin(auction, body.token);
      const index = auction.players.findIndex((item) => item.id === bits[4]);
      if (index < 0) throw Error("Giocatore non trovato");
      if (atomicBidEnabled && supabase) {
        const { error } = await supabase.rpc("call_player", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_player_id: bits[4],
        });
        if (error) throw Error(error.message);
        rememberState(auction);
        if (index !== auction.currentIndex) {
          [auction.players[auction.currentIndex], auction.players[index]] = [
            auction.players[index],
            auction.players[auction.currentIndex],
          ];
        }
        auction.status = "paused";
        auction.rosterWarning = null;
        auction.activity.unshift({
          name: administrator.name,
          action: "chiama " + auction.players[auction.currentIndex].name,
        });
        save(auction.code);
        return json(res, { auction: publicAuction(auction, body.token) });
      }
      if (index < auction.currentIndex)
        throw Error("Questo giocatore è già stato chiamato");
      if (
        index !== auction.currentIndex &&
        auction.players[auction.currentIndex].highestBid
      )
        throw Error("Assegna prima il giocatore attualmente in vendita");
      rememberState(auction);
      [auction.players[auction.currentIndex], auction.players[index]] = [
        auction.players[index],
        auction.players[auction.currentIndex],
      ];
      auction.status = "paused";
      auction.rosterWarning = null;
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "order") {
      const administrator = requireAdmin(auction, body.token);
      if (
        body.order !== undefined &&
        !["alphabetical", "random"].includes(body.order)
      )
        throw Error("Tipo di ordinamento non valido");
      if (body.byRole !== undefined && typeof body.byRole !== "boolean")
        throw Error("Filtro per ruolo non valido");
      if (body.order === undefined && body.byRole === undefined)
        throw Error("Seleziona un ordinamento");
      const completed = auction.players.slice(0, auction.currentIndex);
      const remaining = auction.players.slice(auction.currentIndex);
      if (auction.status === "live")
        throw Error("Metti in pausa l’asta prima di riordinare i giocatori");
      const playerOrder = body.order ?? auction.playerOrder ?? null;
      const orderByRole = body.byRole ?? Boolean(auction.orderByRole);
      const roleIndex = { POR: 0, DIF: 1, CEN: 2, ATT: 3 };
      if (playerOrder === "random") {
        for (let index = remaining.length - 1; index > 0; index--) {
          const randomIndex = Math.floor(Math.random() * (index + 1));
          [remaining[index], remaining[randomIndex]] = [
            remaining[randomIndex],
            remaining[index],
          ];
        }
      }
      if (orderByRole && playerOrder === "alphabetical") {
        remaining.sort(
          (first, second) =>
            roleIndex[first.role] - roleIndex[second.role] ||
            first.name.localeCompare(second.name, "it"),
        );
      } else if (orderByRole) {
        remaining.sort(
          (first, second) => roleIndex[first.role] - roleIndex[second.role],
        );
      } else if (playerOrder === "alphabetical") {
        remaining.sort((first, second) =>
          first.name.localeCompare(second.name, "it"),
        );
      }
      if (atomicBidEnabled && supabase) {
        const { error } = await supabase.rpc("set_player_order", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_player_ids: remaining.map((player) => player.id),
          p_player_order: playerOrder,
          p_order_by_role: orderByRole,
        });
        if (error) throw Error(error.message);
      }
      rememberState(auction);
      auction.players = [...completed, ...remaining];
      auction.playerOrder = playerOrder;
      auction.orderByRole = orderByRole;
      auction.activity.unshift({
        name: administrator.name,
        action: `ordina i giocatori${orderByRole ? " per ruolo" : ""}${playerOrder === "alphabetical" ? " alfabeticamente" : playerOrder === "random" ? " in modo casuale" : ""}`,
      });
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "players" && bits[4]) {
      const administrator = requireAdmin(auction, body.token);
      const player = auction.players.find((item) => item.id === bits[4]);
      const quote = Number(body.quote);
      if (!player) throw Error("Giocatore non trovato");
      if (!auction.tierSettings.some((tier) => tier.name === body.tier))
        throw Error("Fascia non valida");
      if (!Number.isFinite(quote) || quote < 0)
        throw Error("Quotazione non valida");
      if (atomicBidEnabled && supabase) {
        const { error } = await supabase.rpc("update_catalog_player", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_player_id: player.id,
          p_quote: quote,
          p_tier: body.tier,
        });
        if (error) throw Error(error.message);
      }
      rememberState(auction);
      player.quote = quote;
      player.tier = body.tier;
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (
      req.method === "POST" &&
      bits[3] === "participants" &&
      bits[4] &&
      bits[5] === "credits"
    ) {
      const administrator = requireAdmin(auction, body.token);
      const participant = own(auction, bits[4]);
      const amount = Number(body.amount);
      if (!participant || participant.role !== "participant")
        throw Error("Partecipante non trovato");
      if (!Number.isInteger(amount) || amount <= 0)
        throw Error("Inserisci un numero di crediti maggiore di zero");
      if (atomicBidEnabled && supabase) {
        const { error } = await supabase.rpc("add_participant_credits", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_participant_token: participant.token,
          p_amount: amount,
        });
        if (error) throw Error(error.message);
      }
      rememberState(auction);
      participant.budget += amount;
      auction.activity.unshift({
        name: administrator.name,
        action: "aggiunge crediti alla squadra di " + participant.name,
        amount,
      });
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (
      req.method === "DELETE" &&
      bits[3] === "participants" &&
      bits[4] &&
      bits[5] === "players" &&
      bits[6]
    ) {
      const administrator = requireAdmin(auction, body.token);
      const participant = own(auction, bits[4]);
      if (!participant || participant.role !== "participant")
        throw Error("Partecipante non trovato");
      const playerIndex = participant.players.findIndex(
        (player) => player.id === bits[6],
      );
      if (playerIndex < 0) throw Error("Giocatore non trovato nella squadra");
      if (atomicBidEnabled && supabase) {
        const { error } = await supabase.rpc("remove_roster_player", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_participant_token: participant.token,
          p_player_id: bits[6],
        });
        if (error) throw Error(error.message);
      }
      rememberState(auction);
      const [player] = participant.players.splice(playerIndex, 1);
      const catalogPlayer = auction.players.find(
        (catalogItem) => catalogItem.id === player.id,
      );
      if (catalogPlayer) delete catalogPlayer.highestBid;
      calculate(participant);
      auction.activity.unshift({
        name: administrator.name,
        action:
          "rimuove " + player.name + " dalla squadra di " + participant.name,
      });
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "DELETE" && bits[3] === "participants" && bits[4]) {
      const administrator = requireAdmin(auction, body.token);
      const participantIndex = auction.participants.findIndex(
        (participant) =>
          participant.token === bits[4] && participant.role === "participant",
      );
      if (participantIndex < 0) throw Error("Partecipante non trovato");
      if (atomicBidEnabled && supabase) {
        const { error } = await supabase.rpc("remove_auction_participant", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_participant_token: bits[4],
        });
        if (error) throw Error(error.message);
      }
      rememberState(auction);
      const [participant] = auction.participants.splice(participantIndex, 1);
      auction.players.forEach((player) => {
        if (player.highestBid?.participantToken === participant.token)
          delete player.highestBid;
      });
      auction.activity.unshift({
        name: administrator.name,
        action: "rimuove il partecipante " + participant.name,
      });
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "bid") {
      const participant = own(auction, body.token),
        player = auction.players[auction.currentIndex];
      if (!participant || !player) throw Error("Sessione non valida");
      if (atomicBidEnabled && supabase) {
        const { data, error } = await supabase.rpc("place_bid", {
          p_auction_code: auction.code,
          p_participant_token: participant.token,
          p_amount: +body.amount,
        });
        if (error) throw Error(error.message);
        rememberState(auction);
        player.highestBid = {
          participantToken: participant.token,
          participantName: data.participantName,
          amount: data.amount,
        };
        auction.countdownEndsAt = null;
        auction.rosterWarning = data.rosterWarning || null;
        auction.activity.unshift({
          name: data.participantName,
          action: "rilancia su " + player.name,
          amount: data.amount,
        });
        save(auction.code);
        return json(res, {
          auction: publicAuction(auction, participant.token),
        });
      }
      if (auction.status !== "live") throw Error("L’asta non è attiva");
      if (player.highestBid?.participantToken === participant.token)
        throw Error("Sei già in testa con l’ultima offerta");
      calculate(participant);
      const minimum = player.highestBid
        ? player.highestBid.amount + auction.rules[player.tier].increment
        : auction.rules[player.tier].minPrice;
      if (+body.amount < minimum) throw Error("Rilancio minimo: " + minimum);
      if (+body.amount > participant.budget - participant.committed)
        throw Error("Crediti non sufficienti");
      const spent = participant.players
        .filter((item) => item.tier === player.tier)
        .reduce((total, item) => total + item.price, 0);
      if (spent + +body.amount > auction.rules[player.tier].cap)
        throw Error("Superato il tetto Fascia " + player.tier);
      rememberState(auction);
      player.highestBid = {
        participantToken: participant.token,
        participantName: participant.name,
        amount: +body.amount,
      };
      const remainingCredits =
        participant.budget - participant.committed - +body.amount;
      const remainingSlots = Math.max(
        0,
        auction.totalSlots - (participant.players.length + 1),
      );
      const availablePlayers = Math.max(
        0,
        auction.players.length - auction.currentIndex - 1,
      );
      const notEnoughAvailablePlayers = availablePlayers < remainingSlots;
      const minimumRequiredCredits = notEnoughAvailablePlayers
        ? null
        : minimumCompletionCost(auction, remainingSlots);
      auction.rosterWarning =
        notEnoughAvailablePlayers || remainingCredits < minimumRequiredCredits
          ? {
              participantName: participant.name,
              remainingCredits,
              remainingSlots,
              availablePlayers,
              minimumRequiredCredits,
              notEnoughAvailablePlayers,
            }
          : null;
      auction.activity.unshift({
        name: participant.name,
        action: "rilancia su " + player.name,
        amount: +body.amount,
      });
      save(auction.code);
      return json(res, { auction: publicAuction(auction, participant.token) });
    }
    if (req.method === "POST" && bits[3] === "recalculate-tiers") {
      const administrator = requireAdmin(auction, body.token);
      if (atomicBidEnabled && supabase) {
        const { error } = await supabase.rpc("apply_auction_tiers", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_action: "recalculate",
          p_tiers: null,
        });
        if (error) throw Error(error.message);
      }
      rememberState(auction);
      recalculateTiers(auction);
      auction.activity.unshift({
        name: administrator.name,
        action: "ricalcola le fasce dei giocatori",
      });
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "clear-activity") {
      const administrator = requireAdmin(auction, body.token);
      if (atomicBidEnabled && supabase) {
        const { error } = await supabase.rpc("clear_auction_activity", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
        });
        if (error) throw Error(error.message);
      }
      auction.participants.forEach((participant) => {
        participant.players = [];
        participant.committed = 0;
      });
      auction.players.forEach((player) => delete player.highestBid);
      auction.status = "paused";
      auction.currentIndex = 0;
      auction.remainingSlots = auction.totalSlots;
      auction.countdownEndsAt = null;
      auction.startCountdownEndsAt = null;
      auction.rosterWarning = null;
      auction.activity = [];
      auction.history = [];
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "undo") {
      const administrator = requireAdmin(auction, body.token);
      if (!auction.history?.length)
        throw Error("Nessuna operazione da annullare");
      const snapshot = auction.history.at(-1);
      const remainingHistory = auction.history.slice(0, -1);
      if (atomicBidEnabled && supabase) {
        const { error } = await supabase.rpc("restore_auction_state", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_state: snapshot,
          p_history: remainingHistory,
        });
        if (error) throw Error(error.message);
      }
      Object.keys(auction).forEach((key) => delete auction[key]);
      Object.assign(auction, snapshot, { history: remainingHistory });
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (
      req.method === "POST" &&
      ["toggle", "pause", "close", "rules"].includes(bits[3])
    ) {
      const administrator = requireAdmin(auction, body.token);
      if (bits[3] === "close" && atomicBidEnabled && supabase) {
        const player = auction.players[auction.currentIndex];
        if (!player) throw Error("Nessun giocatore da assegnare");
        const { data, error } = await supabase.rpc("close_current_player", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
        });
        if (error) throw Error(error.message);

        rememberState(auction);
        if (data.assigned) {
          const participant = own(auction, data.winnerToken);
          if (!participant) throw Error("Offerente non trovato");
          player.highestBid = {
            participantToken: data.winnerToken,
            participantName: data.winnerName,
            amount: data.amount,
          };
          participant.players.push({ ...player, price: data.amount });
          calculate(participant);
          auction.activity.unshift({
            name: participant.name,
            action: "acquista " + player.name,
            amount: data.amount,
          });
        }
        auction.currentIndex++;
        auction.remainingSlots = Math.max(0, auction.remainingSlots - 1);
        auction.status = "paused";
        auction.rosterWarning = null;
        auction.activity.unshift({
          name: administrator.name,
          action: "mette in pausa l’asta",
        });
        const nextPlayer = auction.players[auction.currentIndex];
        if (nextPlayer)
          auction.activity.unshift({
            name: administrator.name,
            action: "chiama " + nextPlayer.name,
          });
        save(auction.code);
        return json(res, { auction: publicAuction(auction, body.token) });
      }
      if (bits[3] === "toggle" && atomicBidEnabled && supabase) {
        const starting = auction.status !== "live";
        const { data, error } = await supabase.rpc("update_auction_session", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_action: starting ? "schedule_start" : "pause",
        });
        if (error) throw Error(error.message);
        rememberState(auction);
        if (starting) {
          auction.startCountdownEndsAt = data.startCountdownEndsAt;
          auction.countdownEndsAt = null;
          scheduleAtomicSessionCompletion(
            auction,
            administrator,
            "start",
            data.startCountdownEndsAt,
          );
        } else {
          auction.status = data.status;
          auction.countdownEndsAt = null;
          auction.startCountdownEndsAt = null;
          auction.activity.unshift({
            name: administrator.name,
            action: "mette in pausa l’asta",
          });
        }
        save(auction.code);
        return json(res, { auction: publicAuction(auction, body.token) });
      }
      if (bits[3] === "pause" && atomicBidEnabled && supabase) {
        const { data, error } = await supabase.rpc("update_auction_session", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_action: "pause",
        });
        if (error) throw Error(error.message);
        rememberState(auction);
        auction.status = data.status;
        auction.countdownEndsAt = null;
        auction.startCountdownEndsAt = null;
        auction.activity.unshift({
          name: administrator.name,
          action: "mette in pausa l’asta",
        });
        save(auction.code);
        return json(res, { auction: publicAuction(auction, body.token) });
      }
      if (bits[3] === "toggle") {
        if (auction.status === "live") {
          rememberState(auction);
          auction.status = "paused";
          auction.activity.unshift({
            name: administrator.name,
            action: "mette in pausa l’asta",
          });
        } else {
          if (
            auction.startCountdownEndsAt &&
            auction.startCountdownEndsAt > Date.now()
          )
            throw Error("Avvio dell’asta già programmato");
          rememberState(auction);
          auction.startCountdownEndsAt = Date.now() + 5000;
          setTimeout(() => {
            if (
              auction.startCountdownEndsAt &&
              auction.startCountdownEndsAt <= Date.now()
            ) {
              auction.status = "live";
              auction.startCountdownEndsAt = null;
              auction.activity.unshift({
                name: administrator.name,
                action: "avvia l’asta",
              });
              save(auction.code);
            }
          }, 5100);
        }
      }
      if (bits[3] === "pause") {
        rememberState(auction);
        auction.status = "paused";
        auction.activity.unshift({
          name: administrator.name,
          action: "mette in pausa l’asta",
        });
      }
      if (bits[3] === "rules") {
        if (!Array.isArray(body.tiers) || !body.tiers.length)
          throw Error("Inserisci almeno una fascia");
        const names = new Set();
        const tierSettings = body.tiers.map((tier) => {
          const name = String(tier.name || "")
            .trim()
            .toUpperCase();
          if (!/^[A-Z0-9]{1,8}$/.test(name) || names.has(name))
            throw Error("Nome fascia non valido o duplicato");
          names.add(name);
          const values = {
            name,
            minQuote: +tier.minQuote,
            minPrice: +tier.minPrice,
            increment: +tier.increment,
            cap: +tier.cap,
          };
          if (
            Object.values(values)
              .slice(1)
              .some((value) => !Number.isFinite(value) || value < 0)
          )
            throw Error("Valori della fascia non validi");
          return values;
        });
        tierSettings.sort((first, second) => second.minQuote - first.minQuote);
        if (atomicBidEnabled && supabase) {
          const { error } = await supabase.rpc("apply_auction_tiers", {
            p_auction_code: auction.code,
            p_admin_token: administrator.token,
            p_action: "save",
            p_tiers: tierSettings,
          });
          if (error) throw Error(error.message);
        }
        rememberState(auction);
        auction.tierSettings = tierSettings;
        ensureTierSettings(auction);
        recalculateTiers(auction);
      }
      if (bits[3] === "close") {
        const player = auction.players[auction.currentIndex];
        if (!player) throw Error("Nessun giocatore da assegnare");
        rememberState(auction);
        if (player.highestBid) {
          const participant = own(auction, player.highestBid.participantToken);
          participant.players.push({
            ...player,
            price: player.highestBid.amount,
          });
          calculate(participant);
          auction.activity.unshift({
            name: participant.name,
            action: "acquista " + player.name,
            amount: player.highestBid.amount,
          });
        }
        auction.currentIndex++;
        auction.remainingSlots = Math.max(0, auction.remainingSlots - 1);
        auction.status = "paused";
        auction.rosterWarning = null;
        auction.activity.unshift({
          name: administrator.name,
          action: "mette in pausa l’asta",
        });
      }
      save(auction.code);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "GET" && bits[3] === "export") {
      const participant = own(auction, url.searchParams.get("token"));
      if (!participant) throw Error("Sessione non valida");
      if (bits[4] === "all" && participant.role !== "admin")
        throw Error("Operazione riservata all’admin");
      const rows = [
        ["Partecipante", "Giocatore", "Ruolo", "Squadra", "Crediti"],
      ];
      (bits[4] === "all" ? auction.participants : [participant]).forEach(
        (item) =>
          item.players.forEach((player) =>
            rows.push([
              item.name,
              player.name,
              player.role,
              player.team,
              player.price,
            ]),
          ),
      );
      if (bits[4] === "all") {
        rows.push([]);
        rows.push(["Tavolo dell'asta"]);
        rows.push(["Partecipante", "Movimento", "Crediti"]);
        auction.activity.forEach((entry) =>
          rows.push([entry.name, entry.action, entry.amount ?? ""]),
        );
      }
      const csvValue = (value) => {
        const text = String(value ?? "");
        return /[;"\n\r]/.test(text)
          ? `"${text.replaceAll('"', '""')}"`
          : text;
      };
      res.writeHead(200, {
        "content-type": "text/csv;charset=utf-8",
        "content-disposition": 'attachment; filename="fantabid.csv"',
      });
      return res.end(
        rows.map((row) => row.map(csvValue).join(";")).join("\n"),
      );
    }
    if (req.method === "POST" && bits[3] === "import") {
      const administrator = requireAdmin(auction, body.token);
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(Buffer.from(body.data, "base64"), {
        type: "buffer",
      });
      const list = [];
      for (const sheetName of workbook.SheetNames) {
        const sheetRole = {
          Portieri: "POR",
          Difensori: "DIF",
          Centrocampisti: "CEN",
          Attaccanti: "ATT",
        }[sheetName];
        const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
          header: 1,
          defval: "",
        });
        const header = grid.findIndex(
          (row) => row.includes("Nome") && row.includes("Squadra"),
        );
        if (header < 0) continue;
        const nameIndex = grid[header].indexOf("Nome"),
          teamIndex = grid[header].indexOf("Squadra"),
          quoteIndex = grid[header].findIndex((cell) =>
            ["Qt.A", "Quotazione", "Quote"].includes(String(cell).trim()),
          ),
          roleIndex = grid[header].findIndex((cell) =>
            ["Ruolo", "R"].includes(String(cell).trim()),
          );
        grid.slice(header + 1).forEach((row, index) => {
          const quote = Number(row[quoteIndex]) || 0;
          const role = sheetRole || normalizeRole(row[roleIndex]);
          if (
            role &&
            row[nameIndex] &&
            String(row[nameIndex]).trim().length > 2
          )
            list.push({
              id: id(),
              name: String(row[nameIndex]).trim(),
              role,
              team: String(row[teamIndex] || "").trim(),
              nation: "",
              tier: "",
              quote,
              number: "",
            });
        });
      }
      if (!list.length) throw Error("Nessun giocatore riconosciuto");
      let importHistory = null;
      if (atomicBidEnabled && supabase) {
        const { history, ...snapshot } = auction;
        importHistory = [
          ...(history || []),
          JSON.parse(JSON.stringify(snapshot)),
        ];
        if (importHistory.length > 20) importHistory.shift();
        const { error } = await supabase.rpc("import_auction_catalog", {
          p_auction_code: auction.code,
          p_admin_token: administrator.token,
          p_players: list,
          p_history: importHistory,
        });
        if (error) throw Error(error.message);
      } else {
        rememberState(auction);
      }
      auction.players = list;
      recalculateTiers(auction);
      auction.currentIndex = 0;
      auction.playerOrder = null;
      auction.orderByRole = false;
      auction.remainingSlots = auction.totalSlots;
      if (importHistory) auction.history = importHistory;
      save(auction.code);
      return json(res, {
        auction: publicAuction(auction, body.token),
        count: list.length,
      });
    }
    throw Error("Endpoint non trovato");
  } catch (error) {
    json(
      res,
      { error: error.message },
      error.message === "Asta non trovata" ? 404 : 400,
    );
  }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () =>
  console.log(`FantaBid su http://localhost:${port}`),
);
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `La porta ${port} è già in uso. Riprova con: PORT=${port + 1} npm start`,
    );
    process.exit(1);
  }
  throw error;
});
