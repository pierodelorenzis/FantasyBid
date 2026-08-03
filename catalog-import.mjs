const normalizedHeader = (value) => String(value ?? "").trim();
const headerKey = (value) =>
  normalizedHeader(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]/g, "");

function selectSheet(workbook) {
  if (workbook.SheetNames.length === 1) return workbook.SheetNames[0];
  const allPlayersSheet = workbook.SheetNames.find(
    (name) => headerKey(name) === "tutti",
  );
  if (allPlayersSheet) return allPlayersSheet;
  throw Error(
    'Il file con più fogli deve contenere il foglio "Tutti" con tutti i giocatori',
  );
}

export function parseAuctionCatalog(XLSX, workbook, { createId, normalizeRole }) {
  const sheetName = selectSheet(workbook);
  const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
  });
  const formats = [
    {
      name: "fantabid",
      columns: {
        name: "Nome",
        role: "Ruolo",
        team: "Squadra",
        quote: "Quotazione",
        nation: "Nazione",
      },
      required: ["Nome", "Ruolo", "Squadra", "Quotazione"],
    },
    {
      name: "fantacalcio.it",
      columns: {
        name: "Nome",
        role: "R",
        team: "Squadra",
        quote: "Qt.A",
      },
      required: ["R", "Nome", "Squadra", "Qt.A"],
    },
  ];

  let header = -1;
  let format = null;
  let headers = [];
  for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
    const rowHeaders = grid[rowIndex].map(normalizedHeader);
    const rowHeaderKeys = rowHeaders.map(headerKey);
    const matchingFormat = formats.find((candidate) =>
      candidate.required.every((column) =>
        rowHeaderKeys.includes(headerKey(column)),
      ),
    );
    if (!matchingFormat) continue;
    header = rowIndex;
    format = matchingFormat;
    headers = rowHeaders;
    break;
  }
  if (!format) {
    const detectedHeaders = grid
      .slice(0, 12)
      .map((row) => row.map(normalizedHeader).filter(Boolean))
      .sort((first, second) => second.length - first.length)[0]
      ?.slice(0, 15);
    throw Error(
      `Intestazioni non valide nel foglio "${sheetName}". Colonne trovate: ${detectedHeaders?.join(", ") || "nessuna"}`,
    );
  }

  const headerKeys = headers.map(headerKey);
  const indexes = Object.fromEntries(
    Object.entries(format.columns).map(([key, column]) => [
      key,
      headerKeys.indexOf(headerKey(column)),
    ]),
  );
  const importedPlayers = new Set();
  const invalidRows = [];
  const players = [];
  grid.slice(header + 1).forEach((row, index) => {
    if (row.every((cell) => String(cell).trim() === "")) return;
    const name = String(row[indexes.name] || "").trim();
    const role = normalizeRole(row[indexes.role]);
    const team = String(row[indexes.team] || "").trim();
    const quoteValue = String(row[indexes.quote] ?? "").trim();
    const quote = Number(quoteValue);
    const line = header + index + 2;
    if (
      name.length < 3 ||
      !role ||
      !team ||
      !quoteValue ||
      !Number.isFinite(quote) ||
      quote < 0
    ) {
      invalidRows.push(line);
      return;
    }
    const playerKey = [role, name, team]
      .map((value) => value.toLocaleLowerCase("it"))
      .join("|");
    if (importedPlayers.has(playerKey)) {
      invalidRows.push(line);
      return;
    }
    importedPlayers.add(playerKey);
    players.push({
      id: createId(),
      name,
      role,
      team,
      nation:
        indexes.nation >= 0 ? String(row[indexes.nation] || "").trim() : "",
      tier: "",
      quote,
      number: "",
    });
  });

  if (invalidRows.length)
    throw Error(
      `Righe non valide o duplicate nel catalogo: ${invalidRows.slice(0, 10).join(", ")}${invalidRows.length > 10 ? "…" : ""}`,
    );
  if (!players.length) throw Error("Nessun giocatore riconosciuto");
  return { players, format: format.name, sheetName };
}
