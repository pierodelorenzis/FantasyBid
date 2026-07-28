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
const code = `SESSION${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const call = async (action) => {
  const { data, error } = await supabase.rpc("update_auction_session", {
    p_auction_code: code,
    p_admin_token: adminToken,
    p_action: action,
  });
  if (error) throw error;
  return data;
};

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code,
    name: "Test sessione atomica",
    budget: 100,
    status: "paused",
    total_slots: 1,
    remaining_slots: 1,
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

  const start = await call("schedule_start");
  if (start.status !== "paused" || !start.startCountdownEndsAt)
    throw Error("Il countdown di avvio non è stato programmato.");
  await wait(5100);
  const started = await call("complete_start");
  if (started.status !== "live") throw Error("L’asta non è stata avviata.");

  const pause = await call("schedule_pause");
  if (pause.status !== "live" || !pause.countdownEndsAt)
    throw Error("Il countdown di pausa non è stato programmato.");
  await wait(5100);
  const paused = await call("complete_pause");
  if (paused.status !== "paused") throw Error("L’asta non è stata messa in pausa.");

  const [{ data: auction, error: auctionReadError }, { data: activity, error: activityError }] = await Promise.all([
    supabase
      .from("auctions")
      .select("status, countdown_ends_at, start_countdown_ends_at, version")
      .eq("code", code)
      .single(),
    supabase
      .from("auction_activity")
      .select("action")
      .eq("auction_code", code),
  ]);
  if (auctionReadError) throw auctionReadError;
  if (activityError) throw activityError;
  if (
    auction.status !== "paused" ||
    auction.countdown_ends_at !== null ||
    auction.start_countdown_ends_at !== null ||
    Number(auction.version) !== 5 ||
    activity.length !== 2
  ) {
    throw Error("Il test della sessione atomica non ha prodotto lo stato atteso.");
  }
  console.log("Test sessione atomica superato: avvio e pausa con countdown verificati.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
