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
const code = `TEST${randomBytes(3).toString("hex").toUpperCase()}`;
const bidderA = `test-a-${code}`;
const bidderB = `test-b-${code}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code,
    name: "Test atomico puntata",
    budget: 100,
    status: "live",
    total_slots: 2,
    remaining_slots: 2,
    current_index: 0,
    rules: { C: { minPrice: 1, increment: 1, cap: 50 } },
    tier_settings: [{ name: "C", minQuote: 0, minPrice: 1, increment: 1, cap: 50 }],
  });
  if (auctionError) throw auctionError;
  const { error: participantError } = await supabase
    .from("auction_participants")
    .insert([
      { auction_code: code, token: bidderA, name: "Test A", role: "participant", budget: 100, committed: 0 },
      { auction_code: code, token: bidderB, name: "Test B", role: "participant", budget: 100, committed: 0 },
    ]);
  if (participantError) throw participantError;
  const { error: playerError } = await supabase.from("auction_players").insert({
    auction_code: code,
    id: "player-1",
    sequence_index: 0,
    name: "Giocatore test",
    role: "POR",
    tier: "C",
    quote: 1,
  });
  if (playerError) throw playerError;

  const outcomes = await Promise.all([
    supabase.rpc("place_bid", { p_auction_code: code, p_participant_token: bidderA, p_amount: 1 }),
    supabase.rpc("place_bid", { p_auction_code: code, p_participant_token: bidderB, p_amount: 1 }),
  ]);
  const accepted = outcomes.filter((outcome) => !outcome.error);
  const rejected = outcomes.filter((outcome) => outcome.error);
  const { data: player, error: readPlayerError } = await supabase
    .from("auction_players")
    .select("highest_bid_amount, highest_bid_participant_token")
    .eq("auction_code", code)
    .eq("id", "player-1")
    .single();
  if (readPlayerError) throw readPlayerError;
  const { data: activity, error: activityError } = await supabase
    .from("auction_activity")
    .select("id")
    .eq("auction_code", code);
  if (activityError) throw activityError;
  const { data: auction, error: readAuctionError } = await supabase
    .from("auctions")
    .select("version")
    .eq("code", code)
    .single();
  if (readAuctionError) throw readAuctionError;

  if (
    accepted.length !== 1 ||
    rejected.length !== 1 ||
    player.highest_bid_amount !== 1 ||
    ![bidderA, bidderB].includes(player.highest_bid_participant_token) ||
    activity.length !== 1 ||
    Number(auction.version) !== 2
  ) {
    throw Error("Il test atomico non ha prodotto lo stato atteso.");
  }
  console.log("Test atomico superato: una sola puntata simultanea è stata accettata.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
