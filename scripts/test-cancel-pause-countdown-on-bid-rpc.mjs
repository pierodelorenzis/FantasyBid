import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
const supabase = createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const code = `COUNT${randomBytes(3).toString("hex").toUpperCase()}`;
const bidderToken = `bidder-${code}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code, name: "Test reset countdown", budget: 100, status: "live", total_slots: 1,
    remaining_slots: 1, current_index: 0, countdown_ends_at: Date.now() + 5000,
    rules: { C: { minPrice: 1, increment: 1, cap: 50 } },
    tier_settings: [{ name: "C", minQuote: 0, minPrice: 1, increment: 1, cap: 50 }],
  });
  if (auctionError) throw auctionError;
  const { error: participantError } = await supabase.from("auction_participants").insert({
    auction_code: code, token: bidderToken, name: "Offerente test", role: "participant", budget: 100, committed: 0,
  });
  if (participantError) throw participantError;
  const { error: playerError } = await supabase.from("auction_players").insert({
    auction_code: code, id: "player-1", sequence_index: 0, name: "Giocatore test", role: "POR", tier: "C", quote: 1,
  });
  if (playerError) throw playerError;
  const { error: bidError } = await supabase.rpc("place_bid", {
    p_auction_code: code, p_participant_token: bidderToken, p_amount: 1,
  });
  if (bidError) throw bidError;
  const { data: auction, error: readError } = await supabase
    .from("auctions")
    .select("status, countdown_ends_at")
    .eq("code", code)
    .single();
  if (readError) throw readError;
  const remaining = Number(auction.countdown_ends_at) - Date.now();
  if (auction.status !== "live" || remaining < 6000 || remaining > 7000) {
    throw Error("La puntata non ha riavviato il countdown di pausa.");
  }
  console.log("Test countdown superato: la puntata riavvia Ultima chiamata.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
