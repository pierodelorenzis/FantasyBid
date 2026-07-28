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
const code = `TIERS${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;
const tiers = [
  { name: "A", minQuote: 20, minPrice: 10, increment: 2, cap: 50 },
  { name: "B", minQuote: 0, minPrice: 1, increment: 1, cap: 30 },
];

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code,
    name: "Test fasce atomiche",
    budget: 100,
    status: "paused",
    total_slots: 2,
    remaining_slots: 2,
    current_index: 0,
    rules: { B: { minPrice: 1, increment: 1, cap: 30 } },
    tier_settings: [{ name: "B", minQuote: 0, minPrice: 1, increment: 1, cap: 30 }],
  });
  if (auctionError) throw auctionError;
  const { error: participantError } = await supabase.from("auction_participants").insert({
    auction_code: code,
    token: adminToken,
    name: "Admin test",
    role: "admin",
    budget: 100,
  });
  if (participantError) throw participantError;
  const { error: playerError } = await supabase.from("auction_players").insert([
    { auction_code: code, id: "high", sequence_index: 0, name: "Alto", role: "POR", tier: "B", quote: 25 },
    { auction_code: code, id: "low", sequence_index: 1, name: "Basso", role: "POR", tier: "B", quote: 5 },
  ]);
  if (playerError) throw playerError;

  const { data: saved, error: saveError } = await supabase.rpc(
    "apply_auction_tiers",
    { p_auction_code: code, p_admin_token: adminToken, p_action: "save", p_tiers: tiers },
  );
  if (saveError) throw saveError;
  const { error: alterError } = await supabase
    .from("auction_players")
    .update({ tier: "B" })
    .eq("auction_code", code)
    .eq("id", "high");
  if (alterError) throw alterError;
  const { error: recalculateError } = await supabase.rpc("apply_auction_tiers", {
    p_auction_code: code,
    p_admin_token: adminToken,
    p_action: "recalculate",
    p_tiers: null,
  });
  if (recalculateError) throw recalculateError;

  const [{ data: auction, error: auctionReadError }, { data: players, error: playersReadError }, { data: activity, error: activityError }] = await Promise.all([
    supabase.from("auctions").select("rules, tier_settings, version").eq("code", code).single(),
    supabase.from("auction_players").select("id, tier").eq("auction_code", code).order("sequence_index"),
    supabase.from("auction_activity").select("action").eq("auction_code", code),
  ]);
  if (auctionReadError) throw auctionReadError;
  if (playersReadError) throw playersReadError;
  if (activityError) throw activityError;
  if (
    saved.rules.A.minPrice !== 10 ||
    Number(auction.version) !== 3 ||
    players.map((player) => `${player.id}:${player.tier}`).join(",") !== "high:A,low:B" ||
    activity.length !== 1 ||
    activity[0].action !== "ricalcola le fasce dei giocatori"
  ) {
    throw Error("Il test delle fasce atomiche non ha prodotto lo stato atteso.");
  }
  console.log("Test fasce atomiche superato: regole e ricalcolo aggiornati insieme.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
