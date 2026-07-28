import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
const supabase = createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const code = `UNDO${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;
const participantToken = `participant-${code}`;
const restoredState = {
  name: "Stato ripristinato", budget: 100, status: "paused", totalSlots: 2,
  remainingSlots: 1, currentIndex: 1,
  rules: { C: { minPrice: 1, increment: 1, cap: 50 } },
  tierSettings: [{ name: "C", minQuote: 0, minPrice: 1, increment: 1, cap: 50 }],
  playerOrder: "alphabetical", orderByRole: false, countdownEndsAt: null,
  startCountdownEndsAt: null, rosterWarning: null,
  participants: [
    { token: adminToken, name: "Admin test", role: "admin", budget: 100, committed: 0, players: [] },
    { token: participantToken, name: "Partecipante test", role: "participant", budget: 100, committed: 10, players: [{ id: "player-1", name: "Giocatore test", role: "POR", tier: "C", price: 10 }] },
  ],
  players: [
    { id: "player-1", name: "Giocatore test", role: "POR", team: "Test", nation: "", tier: "C", number: "", quote: 1, highestBid: { participantToken, participantName: "Partecipante test", amount: 10 } },
    { id: "player-2", name: "Secondo", role: "DIF", team: "Test", nation: "", tier: "C", number: "", quote: 1 },
  ],
  activity: [{ name: "Partecipante test", action: "acquista Giocatore test", amount: 10 }],
};

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code, name: "Stato attuale", budget: 100, status: "live", total_slots: 2,
    remaining_slots: 2, current_index: 0, rules: {}, tier_settings: [],
  });
  if (auctionError) throw auctionError;
  const { error: adminError } = await supabase.from("auction_participants").insert({
    auction_code: code, token: adminToken, name: "Admin test", role: "admin", budget: 100, committed: 0,
  });
  if (adminError) throw adminError;
  const { data: restored, error: restoreError } = await supabase.rpc("restore_auction_state", {
    p_auction_code: code, p_admin_token: adminToken, p_state: restoredState, p_history: [restoredState],
  });
  if (restoreError) throw restoreError;
  const [{ data: auction, error: auctionReadError }, { data: participants, error: participantsError }, { data: players, error: playersError }, { count: rosterCount, error: rosterError }, { count: activityCount, error: activityError }, { count: historyCount, error: historyError }] = await Promise.all([
    supabase.from("auctions").select("name, status, current_index, remaining_slots, version").eq("code", code).single(),
    supabase.from("auction_participants").select("token, committed").eq("auction_code", code),
    supabase.from("auction_players").select("id, highest_bid_amount").eq("auction_code", code).order("sequence_index"),
    supabase.from("roster_players").select("*", { count: "exact", head: true }).eq("auction_code", code),
    supabase.from("auction_activity").select("*", { count: "exact", head: true }).eq("auction_code", code),
    supabase.from("auction_history").select("*", { count: "exact", head: true }).eq("auction_code", code),
  ]);
  if (auctionReadError || participantsError || playersError || rosterError || activityError || historyError) throw auctionReadError || participantsError || playersError || rosterError || activityError || historyError;
  if (restored.historyLength !== 1 || auction.name !== "Stato ripristinato" || auction.status !== "paused" || auction.current_index !== 1 || auction.remaining_slots !== 1 || Number(auction.version) !== 2 || participants.length !== 2 || players.length !== 2 || players[0].highest_bid_amount !== 10 || rosterCount !== 1 || activityCount !== 1 || historyCount !== 1) {
    throw Error("Il test di ripristino atomico non ha prodotto lo stato atteso.");
  }
  console.log("Test annullamento atomico superato: stato e relazioni ripristinati insieme.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
