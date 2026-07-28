import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
const supabase = createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const code = `CREDIT${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;
const participantToken = `participant-${code}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code, name: "Test accredito", budget: 100, status: "paused", total_slots: 1,
    remaining_slots: 1, current_index: 0, rules: {}, tier_settings: [],
  });
  if (auctionError) throw auctionError;
  const { error: participantsError } = await supabase.from("auction_participants").insert([
    { auction_code: code, token: adminToken, name: "Admin test", role: "admin", budget: 100, committed: 0 },
    { auction_code: code, token: participantToken, name: "Squadra test", role: "participant", budget: 100, committed: 20 },
  ]);
  if (participantsError) throw participantsError;
  const { data: result, error: creditError } = await supabase.rpc("add_participant_credits", {
    p_auction_code: code, p_admin_token: adminToken, p_participant_token: participantToken, p_amount: 25,
  });
  if (creditError) throw creditError;
  const [{ data: participant, error: participantError }, { data: activity, error: activityError }, { data: auction, error: auctionReadError }] = await Promise.all([
    supabase.from("auction_participants").select("budget, committed").eq("auction_code", code).eq("token", participantToken).single(),
    supabase.from("auction_activity").select("name, action, amount").eq("auction_code", code),
    supabase.from("auctions").select("version").eq("code", code).single(),
  ]);
  if (participantError || activityError || auctionReadError) throw participantError || activityError || auctionReadError;
  if (result.budget !== 125 || participant.budget !== 125 || participant.committed !== 20 || activity.length !== 1 || activity[0].amount !== 25 || Number(auction.version) !== 2) {
    throw Error("Il test dell’accredito non ha prodotto lo stato atteso.");
  }
  console.log("Test accredito atomico superato: budget e movimento aggiornati insieme.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
