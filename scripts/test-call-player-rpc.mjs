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
const code = `CALL${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code,
    name: "Test chiamata atomica",
    budget: 100,
    status: "live",
    total_slots: 2,
    remaining_slots: 2,
    current_index: 0,
    rules: {},
    tier_settings: [],
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
  const { error: playerError } = await supabase.from("auction_players").insert([
    {
      auction_code: code,
      id: "player-current",
      sequence_index: 0,
      name: "Primo giocatore",
      role: "POR",
      tier: "C",
      quote: 1,
    },
    {
      auction_code: code,
      id: "player-selected",
      sequence_index: 1,
      name: "Giocatore scelto",
      role: "POR",
      tier: "C",
      quote: 1,
    },
  ]);
  if (playerError) throw playerError;

  const { data: called, error: callError } = await supabase.rpc(
    "call_player",
    {
      p_auction_code: code,
      p_admin_token: adminToken,
      p_player_id: "player-selected",
    },
  );
  if (callError) throw callError;

  const [{ data: auction, error: auctionReadError }, { data: orderedPlayers, error: playerReadError }, { data: activity, error: activityError }] = await Promise.all([
    supabase
      .from("auctions")
      .select("status, current_index, roster_warning, version")
      .eq("code", code)
      .single(),
    supabase
      .from("auction_players")
      .select("id, sequence_index")
      .eq("auction_code", code)
      .order("sequence_index"),
    supabase
      .from("auction_activity")
      .select("name, action")
      .eq("auction_code", code),
  ]);
  if (auctionReadError) throw auctionReadError;
  if (playerReadError) throw playerReadError;
  if (activityError) throw activityError;
  if (
    called.playerId !== "player-selected" ||
    auction.status !== "paused" ||
    auction.current_index !== 0 ||
    auction.roster_warning !== null ||
    Number(auction.version) !== 2 ||
    orderedPlayers[0].id !== "player-selected" ||
    orderedPlayers[1].id !== "player-current" ||
    activity.length !== 1 ||
    activity[0].name !== "Admin test" ||
    activity[0].action !== "chiama Giocatore scelto"
  ) {
    throw Error("Il test della chiamata atomica non ha prodotto lo stato atteso.");
  }
  console.log("Test chiamata atomica superato: ordine e pausa aggiornati insieme.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
