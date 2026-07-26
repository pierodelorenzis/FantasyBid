import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

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
const save = () => fs.writeFileSync(store, JSON.stringify(db, null, 2));
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
  const requesterIsAdmin = own(auction, requester)?.role === "admin";
  const { history, ...auctionData } = auction;
  return {
    ...auctionData,
    canUndo: requesterIsAdmin && Boolean(history?.length),
    currentPlayer: auction.players[auction.currentIndex] || null,
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
    { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
      path.extname(safe)
    ] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
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
      save();
      return json(res, {
        code: auctionCode,
        adminToken: token,
        adminName: body.adminName,
      });
    }
    const auction = db.auctions[bits[2]];
    if (!auction) throw Error("Asta non trovata");
    ensureTierSettings(auction);
    if (req.method === "GET" && bits.length === 3)
      return json(res, publicAuction(auction, url.searchParams.get("token")));
    if (req.method === "POST" && bits[3] === "join") {
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
        save();
      }
      return json(res, { token: participant.token });
    }
    if (req.method === "POST" && bits[3] === "countdown") {
      const administrator = requireAdmin(auction, body.token);
      if (auction.status !== "live") throw Error("L’asta non è attiva");
      if (auction.countdownEndsAt && auction.countdownEndsAt > Date.now())
        throw Error("Countdown già attivo");
      rememberState(auction);
      auction.countdownEndsAt = Date.now() + 5000;
      save();
      setTimeout(() => {
        if (auction.countdownEndsAt && auction.countdownEndsAt <= Date.now()) {
          auction.status = "paused";
          auction.countdownEndsAt = null;
          auction.activity.unshift({
            name: administrator.name,
            action: "mette in pausa l’asta",
          });
          save();
        }
      }, 5100);
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "call" && bits[4]) {
      requireAdmin(auction, body.token);
      const index = auction.players.findIndex((item) => item.id === bits[4]);
      if (index < 0) throw Error("Giocatore non trovato");
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
      save();
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
      rememberState(auction);
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
      auction.players = [...completed, ...remaining];
      auction.playerOrder = playerOrder;
      auction.orderByRole = orderByRole;
      auction.activity.unshift({
        name: administrator.name,
        action: `ordina i giocatori${orderByRole ? " per ruolo" : ""}${playerOrder === "alphabetical" ? " alfabeticamente" : playerOrder === "random" ? " in modo casuale" : ""}`,
      });
      save();
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "players" && bits[4]) {
      requireAdmin(auction, body.token);
      const player = auction.players.find((item) => item.id === bits[4]);
      const quote = Number(body.quote);
      if (!player) throw Error("Giocatore non trovato");
      if (!auction.tierSettings.some((tier) => tier.name === body.tier))
        throw Error("Fascia non valida");
      if (!Number.isFinite(quote) || quote < 0)
        throw Error("Quotazione non valida");
      rememberState(auction);
      player.quote = quote;
      player.tier = body.tier;
      save();
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
      rememberState(auction);
      const [player] = participant.players.splice(playerIndex, 1);
      calculate(participant);
      auction.activity.unshift({
        name: administrator.name,
        action:
          "rimuove " + player.name + " dalla squadra di " + participant.name,
      });
      save();
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "DELETE" && bits[3] === "participants" && bits[4]) {
      const administrator = requireAdmin(auction, body.token);
      const participantIndex = auction.participants.findIndex(
        (participant) =>
          participant.token === bits[4] && participant.role === "participant",
      );
      if (participantIndex < 0) throw Error("Partecipante non trovato");
      rememberState(auction);
      const [participant] = auction.participants.splice(participantIndex, 1);
      auction.activity.unshift({
        name: administrator.name,
        action: "rimuove il partecipante " + participant.name,
      });
      save();
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "bid") {
      const participant = own(auction, body.token),
        player = auction.players[auction.currentIndex];
      if (!participant || !player) throw Error("Sessione non valida");
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
      save();
      return json(res, { auction: publicAuction(auction, participant.token) });
    }
    if (req.method === "POST" && bits[3] === "recalculate-tiers") {
      const administrator = requireAdmin(auction, body.token);
      rememberState(auction);
      recalculateTiers(auction);
      auction.activity.unshift({
        name: administrator.name,
        action: "ricalcola le fasce dei giocatori",
      });
      save();
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "clear-activity") {
      requireAdmin(auction, body.token);
      rememberState(auction);
      auction.activity = [];
      save();
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (req.method === "POST" && bits[3] === "undo") {
      requireAdmin(auction, body.token);
      if (!auction.history?.length)
        throw Error("Nessuna operazione da annullare");
      const snapshot = auction.history.pop();
      const remainingHistory = auction.history;
      Object.keys(auction).forEach((key) => delete auction[key]);
      Object.assign(auction, snapshot, { history: remainingHistory });
      save();
      return json(res, { auction: publicAuction(auction, body.token) });
    }
    if (
      req.method === "POST" &&
      ["toggle", "pause", "close", "rules"].includes(bits[3])
    ) {
      const administrator = requireAdmin(auction, body.token);
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
              save();
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
        rememberState(auction);
        auction.tierSettings = body.tiers.map((tier) => {
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
      save();
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
      res.writeHead(200, {
        "content-type": "text/csv;charset=utf-8",
        "content-disposition": 'attachment; filename="fantabid.csv"',
      });
      return res.end(rows.map((row) => row.join(";")).join("\n"));
    }
    if (req.method === "POST" && bits[3] === "import") {
      requireAdmin(auction, body.token);
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
              id: "i" + Date.now() + index + list.length,
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
      rememberState(auction);
      auction.players = list;
      recalculateTiers(auction);
      auction.currentIndex = 0;
      auction.playerOrder = null;
      auction.orderByRole = false;
      auction.remainingSlots = auction.totalSlots;
      save();
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
server.listen(port, () => console.log(`FantaBid su http://localhost:${port}`));
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `La porta ${port} è già in uso. Riprova con: PORT=${port + 1} npm start`,
    );
    process.exit(1);
  }
  throw error;
});
