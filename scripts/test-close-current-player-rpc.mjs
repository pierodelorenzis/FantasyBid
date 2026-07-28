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
const code = `CLOSE${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;
const bidderToken = `bidder-${code}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code,
    name: "Test assegnazione atomica",
    budget: 100,
    status: "live",
    total_slots: 2,
    remaining_slots: 2,
    current_index: 0,
    rules: { C: { minPrice: 1, increment: 1, cap: 50 } },
    tier_settings: [
      { name: "C", minQuote: 0, minPrice: 1, increment: 1, cap: 50 },
    ],
  });
  if (auctionError) throw auctionError;

  const { error: participantError } = await supabase
    .from("auction_participants")
    .insert([
      {
        auction_code: code,
        token: adminToken,
        name: "Admin test",
        role: "admin",
        budget: 100,
      },
      {
        auction_code: code,
        token: bidderToken,
        name: "Offerente test",
        role: "participant",
        budget: 100,
      },
    ]);
  if (participantError) throw participantError;

  const { error: playerError } = await supabase.from("auction_players").insert([
    {
      auction_code: code,
      id: "player-1",
      sequence_index: 0,
      name: "Giocatore test",
      role: "POR",
      tier: "C",
      quote: 1,
    },
    {
      auction_code: code,
      id: "player-2",
      sequence_index: 1,
      name: "Giocatore successivo",
      role: "DIF",
      tier: "C",
      quote: 1,
    },
  ]);
  if (playerError) throw playerError;

  const { error: bidError } = await supabase.rpc("place_bid", {
    p_auction_code: code,
    p_participant_token: bidderToken,
    p_amount: 10,
  });
  if (bidError) throw bidError;

  const { data: closed, error: closeError } = await supabase.rpc(
    "close_current_player",
    { p_auction_code: code, p_admin_token: adminToken },
  );
  if (closeError) throw closeError;

  const [{ data: auction, error: auctionReadError }, { data: participant, error: participantReadError }, { data: roster, error: rosterReadError }, { data: activity, error: activityReadError }] = await Promise.all([
    supabase
      .from("auctions")
      .select("status, current_index, remaining_slots, version")
      .eq("code", code)
      .single(),
    supabase
      .from("auction_participants")
      .select("committed")
      .eq("auction_code", code)
      .eq("token", bidderToken)
      .single(),
    supabase
      .from("roster_players")
      .select("price")
      .eq("auction_code", code),
    supabase
      .from("auction_activity")
      .select("action, amount")
      .eq("auction_code", code),
  ]);
  if (auctionReadError) throw auctionReadError;
  if (participantReadError) throw participantReadError;
  if (rosterReadError) throw rosterReadError;
  if (activityReadError) throw activityReadError;

  if (
    !closed.assigned ||
    auction.status !== "paused" ||
    auction.current_index !== 1 ||
    auction.remaining_slots !== 1 ||
    Number(auction.version) !== 3 ||
    participant.committed !== 10 ||
    roster.length !== 1 ||
    roster[0].price !== 10 ||
    activity.length !== 4 ||
    !activity.some((entry) => entry.action === "chiama Giocatore successivo")
  ) {
    throw Error("Il test di assegnazione atomica non ha prodotto lo stato atteso.");
  }
  console.log("Test assegnazione atomica superato: rosa, budget e asta aggiornati insieme.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
