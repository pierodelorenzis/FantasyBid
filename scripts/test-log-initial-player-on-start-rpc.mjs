import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
const supabase = createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const code = `FIRST${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code, name: "Test chiamata iniziale", budget: 100, status: "paused", total_slots: 1,
    remaining_slots: 1, current_index: 0, rules: {}, tier_settings: [],
  });
  if (auctionError) throw auctionError;
  const { error: adminError } = await supabase.from("auction_participants").insert({
    auction_code: code, token: adminToken, name: "Admin test", role: "admin", budget: 100, committed: 0,
  });
  if (adminError) throw adminError;
  const { error: playerError } = await supabase.from("auction_players").insert({
    auction_code: code, id: "first-player", sequence_index: 0, name: "Primo giocatore", role: "POR", tier: "C", quote: 1,
  });
  if (playerError) throw playerError;
  const { error: scheduleError } = await supabase.rpc("update_auction_session", {
    p_auction_code: code, p_admin_token: adminToken, p_action: "schedule_start",
  });
  if (scheduleError) throw scheduleError;
  await wait(5100);
  const { error: startError } = await supabase.rpc("update_auction_session", {
    p_auction_code: code, p_admin_token: adminToken, p_action: "complete_start",
  });
  if (startError) throw startError;
  const { data: activity, error: activityError } = await supabase
    .from("auction_activity")
    .select("action")
    .eq("auction_code", code);
  if (activityError) throw activityError;
  if (!activity.some((entry) => entry.action === "chiama Primo giocatore")) {
    throw Error("La chiamata del primo giocatore non è stata registrata.");
  }
  console.log("Test chiamata iniziale superato: il primo giocatore viene registrato all’avvio.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
