import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = path.resolve(
  root,
  process.env.FANTABID_DATA_FILE || "data.json",
);
const overwrite = process.argv.includes("--overwrite");
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  throw Error(
    "Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env prima di eseguire la migrazione.",
  );
}
if (!fs.existsSync(sourceFile)) throw Error(`File non trovato: ${sourceFile}`);

const data = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
const auctions = Object.entries(data.auctions || {});
const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let imported = 0;
let skipped = 0;
for (const [code, auction] of auctions) {
  const { data: existing, error: lookupError } = await supabase
    .from("auction_snapshots")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing && !overwrite) {
    skipped++;
    continue;
  }
  const { error } = await supabase.from("auction_snapshots").upsert(
    {
      code,
      state: auction,
      version: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "code" },
  );
  if (error) throw error;
  imported++;
}

const { count, error: countError } = await supabase
  .from("auction_snapshots")
  .select("*", { count: "exact", head: true });
if (countError) throw countError;

console.log(
  `Migrazione completata: ${imported} importate, ${skipped} già presenti. Aste su Supabase: ${count}.`,
);
