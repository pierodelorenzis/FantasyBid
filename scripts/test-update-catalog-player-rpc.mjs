import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const code = `CATALOG${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code,
    name: "Test catalogo atomico",
    budget: 100,
    status: "paused",
    total_slots: 1,
    remaining_slots: 1,
    current_index: 0,
    rules: {},
    tier_settings: [
      { name: "A", minQuote: 10, minPrice: 10, increment: 1, cap: 50 },
      { name: "B", minQuote: 0, minPrice: 1, increment: 1, cap: 50 },
    ],
  });
  if (auctionError) throw auctionError;
  const { error: participantError } = await supabase
    .from("auction_participants")
    .insert({
      auction_code: code,
      token: adminToken,
      name: "Admin test",
      role: "admin",
      budget: 100,
    });
  if (participantError) throw participantError;
  const { error: playerError } = await supabase.from("auction_players").insert({
    auction_code: code,
    id: "player-1",
    sequence_index: 0,
    name: "Giocatore test",
    role: "POR",
    tier: "B",
    quote: 1,
  });
  if (playerError) throw playerError;

  const { data: updated, error: updateError } = await supabase.rpc(
    "update_catalog_player",
    {
      p_auction_code: code,
      p_admin_token: adminToken,
      p_player_id: "player-1",
      p_quote: 15,
      p_tier: "A",
    },
  );
  if (updateError) throw updateError;
  const [{ data: auction, error: auctionReadError }, { data: player, error: playerReadError }] = await Promise.all([
    supabase.from("auctions").select("version").eq("code", code).single(),
    supabase
      .from("auction_players")
      .select("quote, tier")
      .eq("auction_code", code)
      .eq("id", "player-1")
      .single(),
  ]);
  if (auctionReadError) throw auctionReadError;
  if (playerReadError) throw playerReadError;
  if (
    updated.quote !== 15 ||
    updated.tier !== "A" ||
    Number(auction.version) !== 2 ||
    player.quote !== 15 ||
    player.tier !== "A"
  ) {
    throw Error("Il test dell’aggiornamento catalogo non ha prodotto lo stato atteso.");
  }
  console.log("Test catalogo atomico superato: quotazione e fascia aggiornate insieme.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
