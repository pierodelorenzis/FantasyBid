import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: snapshots, error: snapshotError } = await supabase
  .from("auction_snapshots")
  .select("code, state, version");
if (snapshotError) throw snapshotError;

let repaired = 0;
for (const snapshot of snapshots) {
  const administrator = snapshot.state.participants.find(
    (participant) => participant.role === "admin",
  );
  if (!administrator) continue;
  const rosterKeys = new Set(
    snapshot.state.participants.flatMap((participant) =>
      (participant.players || []).map(
        (player) => `${participant.token}:${player.id}`,
      ),
    ),
  );
  const unassignedIds = snapshot.state.players
    .slice(0, snapshot.state.currentIndex)
    .filter(
      (player) =>
        player.highestBid &&
        !rosterKeys.has(`${player.highestBid.participantToken}:${player.id}`),
    )
    .map((player) => player.id);
  if (!unassignedIds.length) continue;

  const { data: cleanup, error: cleanupError } = await supabase.rpc(
    "clear_completed_unassigned_bids",
    {
      p_auction_code: snapshot.code,
      p_admin_token: administrator.token,
    },
  );
  if (cleanupError) throw cleanupError;
  const remoteIds = new Set(cleanup.playerIds || []);
  if (unassignedIds.some((id) => !remoteIds.has(id))) {
    throw Error(`Pulizia incompleta per l’asta ${snapshot.code}.`);
  }

  const state = structuredClone(snapshot.state);
  state.players.forEach((player, index) => {
    if (index < state.currentIndex && unassignedIds.includes(player.id))
      delete player.highestBid;
  });
  const { data: replaced, error: replaceError } = await supabase.rpc(
    "replace_auction_snapshot",
    {
      p_code: snapshot.code,
      p_expected_version: snapshot.version,
      p_state: state,
    },
  );
  if (replaceError) throw replaceError;
  if (!replaced?.length)
    throw Error(`Conflitto di versione durante la pulizia dell’asta ${snapshot.code}.`);
  repaired += unassignedIds.length;
  console.log(`${snapshot.code}: eliminate ${unassignedIds.length} assegnazioni rimosse dalla rosa.`);
}

console.log(`Pulizia completata: ${repaired} assegnazioni eliminate.`);
