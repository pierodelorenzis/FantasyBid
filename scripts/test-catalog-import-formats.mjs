import assert from "node:assert/strict";
import XLSX from "xlsx";
import { parseAuctionCatalog } from "../catalog-import.mjs";

const roles = {
  P: "POR",
  POR: "POR",
  D: "DIF",
  DIF: "DIF",
  C: "CEN",
  CEN: "CEN",
  A: "ATT",
  ATT: "ATT",
};
const normalizeRole = (value) => roles[String(value).trim().toUpperCase()];
let nextId = 0;
const createId = () => `test-${++nextId}`;
const sheet = (rows) => XLSX.utils.aoa_to_sheet(rows);

const fantabidWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  fantabidWorkbook,
  sheet([
    ["Nome", "Ruolo", "Squadra", "Nazione", "Quotazione"],
    ["Mario Rossi", "POR", "Roma", "Italia", 12],
    ["Luigi Verdi", "ATT", "Milan", "Italia", 25],
  ]),
  "Catalogo",
);
const standard = parseAuctionCatalog(XLSX, fantabidWorkbook, {
  createId,
  normalizeRole,
});
assert.equal(standard.format, "fantabid");
assert.equal(standard.players.length, 2);
assert.deepEqual(
  standard.players.map(({ name, role, quote, nation }) => ({
    name,
    role,
    quote,
    nation,
  })),
  [
    { name: "Mario Rossi", role: "POR", quote: 12, nation: "Italia" },
    { name: "Luigi Verdi", role: "ATT", quote: 25, nation: "Italia" },
  ],
);

const fantacalcioWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  fantacalcioWorkbook,
  sheet([
    ["Quotazioni Fantacalcio Stagione 2025 26"],
    ["Id", "R", "RM", "Nome", "Squadra", "Qt.A", "Qt.I"],
    [4431, "P", "Por", "Carnesecchi", "Atalanta", 18, 14],
    [254, "D", "E", "Dimarco", "Inter", 30, 19],
    [6875, "C", "T;A", "Paz N.", "Como", 26, 20],
    [2764, "A", "Pc", "Martinez L.", "Inter", 33, 34],
  ]),
  "Tutti",
);
XLSX.utils.book_append_sheet(
  fantacalcioWorkbook,
  sheet([
    ["Id", "R", "Nome", "Squadra", "Qt.A"],
    [9999, "A", "Giocatore da ignorare", "Estero", 50],
  ]),
  "Ceduti",
);
const official = parseAuctionCatalog(XLSX, fantacalcioWorkbook, {
  createId,
  normalizeRole,
});
assert.equal(official.format, "fantacalcio.it");
assert.equal(official.sheetName, "Tutti");
assert.equal(official.players.length, 4);
assert.deepEqual(
  official.players.map(({ name, role, team, quote, nation }) => ({
    name,
    role,
    team,
    quote,
    nation,
  })),
  [
    { name: "Carnesecchi", role: "POR", team: "Atalanta", quote: 18, nation: "" },
    { name: "Dimarco", role: "DIF", team: "Inter", quote: 30, nation: "" },
    { name: "Paz N.", role: "CEN", team: "Como", quote: 26, nation: "" },
    { name: "Martinez L.", role: "ATT", team: "Inter", quote: 33, nation: "" },
  ],
);

console.log("Test import cataloghi superato: FantaBid e Fantacalcio.it.");
