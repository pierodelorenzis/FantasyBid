import { createClient } from "@supabase/supabase-js";

const code = String(process.argv[2] || "").toUpperCase();
if (!/^[A-Z0-9]{6}$/.test(code)) {
  throw Error("Indica il codice dell’asta da resettare, ad esempio: npm run reset:auction -- ABC123");
}
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
}
const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: snapshot, error: snapshotError } = await supabase
  .from("auction_snapshots")
  .select("code, state, version")
  .eq("code", code)
  .single();
if (snapshotError) throw snapshotError;
const administrator = snapshot.state.participants.find(
  (participant) => participant.role === "admin",
);
if (!administrator) throw Error("Amministratore dell’asta non trovato.");

const { error: resetError } = await supabase.rpc("clear_auction_activity", {
  p_auction_code: code,
  p_admin_token: administrator.token,
});
if (resetError) throw resetError;

const state = structuredClone(snapshot.state);
state.participants.forEach((participant) => {
  participant.players = [];
  participant.committed = 0;
});
state.players.forEach((player) => delete player.highestBid);
state.status = "paused";
state.currentIndex = 0;
state.remainingSlots = state.totalSlots;
state.countdownEndsAt = null;
state.startCountdownEndsAt = null;
state.rosterWarning = null;
state.activity = [];
state.history = [];
const { data: replaced, error: replaceError } = await supabase.rpc(
  "replace_auction_snapshot",
  {
    p_code: code,
    p_expected_version: snapshot.version,
    p_state: state,
  },
);
if (replaceError) throw replaceError;
if (!replaced?.length) throw Error("Conflitto di versione: reset non applicato.");
console.log(`${code}: asta resettata al primo giocatore.`);
