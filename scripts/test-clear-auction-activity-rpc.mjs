import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
const supabase = createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const code = `CLEAR${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code, name: "Test pulizia movimenti", budget: 100, status: "live", total_slots: 2,
    remaining_slots: 1, current_index: 1, rules: {}, tier_settings: [], roster_warning: { participantName: "Admin test" },
  });
  if (auctionError) throw auctionError;
  const { error: adminError } = await supabase.from("auction_participants").insert({
    auction_code: code, token: adminToken, name: "Admin test", role: "admin", budget: 125, committed: 0,
  });
  if (adminError) throw adminError;
  const { error: playerError } = await supabase.from("auction_players").insert({
    auction_code: code, id: "player-1", sequence_index: 0, name: "Giocatore test", role: "POR", tier: "C", quote: 1,
    highest_bid_participant_token: adminToken, highest_bid_participant_name: "Admin test", highest_bid_amount: 10,
  });
  if (playerError) throw playerError;
  const { error: rosterError } = await supabase.from("roster_players").insert({
    auction_code: code, participant_token: adminToken, player_id: "player-1", price: 10,
  });
  if (rosterError) throw rosterError;
  const { error: committedError } = await supabase.from("auction_participants").update({ committed: 10 }).eq("auction_code", code).eq("token", adminToken);
  if (committedError) throw committedError;
  const { error: activityError } = await supabase.from("auction_activity").insert([
    { auction_code: code, position: 0, name: "Admin test", action: "azione 1" },
    { auction_code: code, position: 1, name: "Admin test", action: "azione 2" },
  ]);
  if (activityError) throw activityError;
  const { data: cleared, error: clearError } = await supabase.rpc("clear_auction_activity", {
    p_auction_code: code, p_admin_token: adminToken,
  });
  if (clearError) throw clearError;
  const [{ data: auction, error: auctionReadError }, { count, error: countError }, { count: rosterCount, error: rosterCountError }, { data: player, error: playerReadError }, { data: participant, error: participantReadError }] = await Promise.all([
    supabase.from("auctions").select("version, status, current_index, remaining_slots, roster_warning").eq("code", code).single(),
    supabase.from("auction_activity").select("*", { count: "exact", head: true }).eq("auction_code", code),
    supabase.from("roster_players").select("*", { count: "exact", head: true }).eq("auction_code", code),
    supabase.from("auction_players").select("highest_bid_amount").eq("auction_code", code).eq("id", "player-1").single(),
    supabase.from("auction_participants").select("budget, committed").eq("auction_code", code).eq("token", adminToken).single(),
  ]);
  if (auctionReadError) throw auctionReadError;
  if (countError) throw countError;
  if (rosterCountError) throw rosterCountError;
  if (playerReadError) throw playerReadError;
  if (participantReadError) throw participantReadError;
  if (cleared.deletedCount !== 2 || count !== 0 || rosterCount !== 0 || player.highest_bid_amount !== null || participant.budget !== 100 || participant.committed !== 0 || auction.status !== "paused" || auction.current_index !== 0 || auction.remaining_slots !== 2 || auction.roster_warning !== null || Number(auction.version) !== 2) {
    throw Error("Il test della pulizia movimenti non ha prodotto lo stato atteso.");
  }
  console.log("Test pulizia movimenti superato: cronologia e crediti extra azzerati atomicamente.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
