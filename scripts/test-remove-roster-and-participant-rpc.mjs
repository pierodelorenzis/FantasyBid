import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
const supabase = createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const code = `REMOVE${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;
const participantA = `participant-a-${code}`;
const participantB = `participant-b-${code}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code, name: "Test rimozioni atomiche", budget: 100, status: "paused", total_slots: 2,
    remaining_slots: 2, current_index: 0, rules: {}, tier_settings: [],
  });
  if (auctionError) throw auctionError;
  const { error: participantError } = await supabase.from("auction_participants").insert([
    { auction_code: code, token: adminToken, name: "Admin test", role: "admin", budget: 100, committed: 0 },
    { auction_code: code, token: participantA, name: "Squadra A", role: "participant", budget: 100, committed: 12 },
    { auction_code: code, token: participantB, name: "Squadra B", role: "participant", budget: 100, committed: 0 },
  ]);
  if (participantError) throw participantError;
  const { error: playerError } = await supabase.from("auction_players").insert({
    auction_code: code, id: "player-1", sequence_index: 0, name: "Giocatore test", role: "POR", tier: "C", quote: 1,
    highest_bid_participant_token: participantA, highest_bid_participant_name: "Squadra A", highest_bid_amount: 12,
  });
  if (playerError) throw playerError;
  const { error: rosterError } = await supabase.from("roster_players").insert({
    auction_code: code, participant_token: participantA, player_id: "player-1", price: 12,
  });
  if (rosterError) throw rosterError;

  const { error: removePlayerError } = await supabase.rpc("remove_roster_player", {
    p_auction_code: code, p_admin_token: adminToken, p_participant_token: participantA, p_player_id: "player-1",
  });
  if (removePlayerError) throw removePlayerError;
  const { error: removeParticipantError } = await supabase.rpc("remove_auction_participant", {
    p_auction_code: code, p_admin_token: adminToken, p_participant_token: participantA,
  });
  if (removeParticipantError) throw removeParticipantError;

  const [{ data: auction, error: auctionReadError }, { data: participants, error: participantsReadError }, { data: roster, error: rosterReadError }, { data: players, error: playersReadError }, { data: activity, error: activityError }] = await Promise.all([
    supabase.from("auctions").select("version").eq("code", code).single(),
    supabase.from("auction_participants").select("token, committed").eq("auction_code", code),
    supabase.from("roster_players").select("player_id").eq("auction_code", code),
    supabase.from("auction_players").select("highest_bid_participant_token").eq("auction_code", code).eq("id", "player-1").single(),
    supabase.from("auction_activity").select("action").eq("auction_code", code),
  ]);
  if (auctionReadError) throw auctionReadError;
  if (participantsReadError) throw participantsReadError;
  if (rosterReadError) throw rosterReadError;
  if (playersReadError) throw playersReadError;
  if (activityError) throw activityError;
  if (Number(auction.version) !== 3 || participants.length !== 2 || participants.some((participant) => participant.token === participantA) || roster.length !== 0 || players.highest_bid_participant_token !== null || activity.length !== 2) {
    throw Error("Il test delle rimozioni atomiche non ha prodotto lo stato atteso.");
  }
  console.log("Test rimozioni atomiche superato: rosa, budget e partecipanti aggiornati insieme.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
