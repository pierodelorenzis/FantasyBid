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
const code = `ORDER${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code,
    name: "Test ordinamento atomico",
    budget: 100,
    status: "paused",
    total_slots: 4,
    remaining_slots: 3,
    current_index: 1,
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
    { auction_code: code, id: "called", sequence_index: 0, name: "Chiamato", role: "POR", tier: "C", quote: 1 },
    { auction_code: code, id: "first", sequence_index: 1, name: "Primo", role: "POR", tier: "C", quote: 1 },
    { auction_code: code, id: "second", sequence_index: 2, name: "Secondo", role: "DIF", tier: "C", quote: 1 },
    { auction_code: code, id: "third", sequence_index: 3, name: "Terzo", role: "ATT", tier: "C", quote: 1 },
  ]);
  if (playerError) throw playerError;

  const { data: ordered, error: orderError } = await supabase.rpc(
    "set_player_order",
    {
      p_auction_code: code,
      p_admin_token: adminToken,
      p_player_ids: ["third", "first", "second"],
      p_player_order: "alphabetical",
      p_order_by_role: true,
    },
  );
  if (orderError) throw orderError;
  const [{ data: auction, error: auctionReadError }, { data: players, error: playersReadError }, { data: activity, error: activityError }] = await Promise.all([
    supabase
      .from("auctions")
      .select("player_order, order_by_role, version")
      .eq("code", code)
      .single(),
    supabase
      .from("auction_players")
      .select("id")
      .eq("auction_code", code)
      .order("sequence_index"),
    supabase
      .from("auction_activity")
      .select("action")
      .eq("auction_code", code),
  ]);
  if (auctionReadError) throw auctionReadError;
  if (playersReadError) throw playersReadError;
  if (activityError) throw activityError;
  if (
    ordered.playerOrder !== "alphabetical" ||
    !ordered.orderByRole ||
    auction.player_order !== "alphabetical" ||
    !auction.order_by_role ||
    Number(auction.version) !== 2 ||
    players.map((player) => player.id).join(",") !== "called,third,first,second" ||
    activity.length !== 1
  ) {
    throw Error("Il test dell’ordinamento atomico non ha prodotto lo stato atteso.");
  }
  console.log("Test ordinamento atomico superato: sequenza e impostazioni aggiornate insieme.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
