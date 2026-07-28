import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = path.resolve(
  root,
  process.env.FANTABID_DATA_FILE || "data.json",
);
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
}

const localAuctions = JSON.parse(fs.readFileSync(sourceFile, "utf8")).auctions || {};
const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: remoteAuctions, error } = await supabase
  .from("auction_snapshots")
  .select("code, state")
  .order("code");
if (error) throw error;

const remoteByCode = new Map(remoteAuctions.map((auction) => [auction.code, auction.state]));
const localCodes = Object.keys(localAuctions).sort();
const remoteCodes = [...remoteByCode.keys()].sort();
const missingRemote = localCodes.filter((code) => !remoteByCode.has(code));
const unexpectedRemote = remoteCodes.filter((code) => !localAuctions[code]);
const mismatched = localCodes.filter(
  (code) =>
    remoteByCode.has(code) &&
    !isDeepStrictEqual(localAuctions[code], remoteByCode.get(code)),
);

if (missingRemote.length || unexpectedRemote.length || mismatched.length) {
  console.error("Verifica non superata.");
  if (missingRemote.length)
    console.error("Aste mancanti su Supabase:", missingRemote.join(", "));
  if (unexpectedRemote.length)
    console.error("Aste aggiuntive su Supabase:", unexpectedRemote.join(", "));
  if (mismatched.length)
    console.error("Aste con contenuto differente:", mismatched.join(", "));
  process.exitCode = 1;
} else {
  console.log(
    `Verifica superata: ${localCodes.length} aste e tutti i relativi dati coincidono con data.json.`,
  );
}
