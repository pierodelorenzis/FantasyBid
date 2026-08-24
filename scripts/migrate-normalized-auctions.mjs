import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const overwrite = process.argv.includes("--overwrite");
const { count, error: countError } = await supabase
  .from("auctions")
  .select("*", { count: "exact", head: true });
if (countError) throw countError;
if (count && !overwrite) {
  throw Error(
    "Le tabelle relazionali contengono già dati. La migrazione iniziale non sovrascrive dati esistenti.",
  );
}

if (count && overwrite) {
  const { error: deleteError } = await supabase
    .from("auctions")
    .delete()
    .neq("code", "");
  if (deleteError) throw deleteError;
}

const { data: snapshots, error: snapshotError } = await supabase
  .from("auction_snapshots")
  .select("code, state, version");
if (snapshotError) throw snapshotError;

const insert = async (table, rows) => {
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await supabase
      .from(table)
      .insert(rows.slice(offset, offset + 500));
    if (error) throw error;
  }
};

const auctions = snapshots.map(({ code, state, version }) => ({
  code,
  name: state.name,
  budget: state.budget,
  status: state.status,
  total_slots: state.totalSlots,
  remaining_slots: state.remainingSlots,
  current_index: state.currentIndex,
  rules: state.rules,
  tier_settings: state.tierSettings || [],
  player_order: state.playerOrder || null,
  order_by_role: Boolean(state.orderByRole),
  countdown_ends_at: state.countdownEndsAt || null,
  start_countdown_ends_at: state.startCountdownEndsAt || null,
  bid_duration_seconds: state.bidDurationSeconds || 30,
  bid_countdown_ends_at: state.bidCountdownEndsAt || null,
  roster_warning: state.rosterWarning || null,
  version,
}));
const participants = snapshots.flatMap(({ code, state }) =>
  state.participants.map((participant) => ({
    auction_code: code,
    token: participant.token,
    name: participant.name,
    role: participant.role,
    budget: participant.budget,
    committed: participant.committed || 0,
  })),
);
const players = snapshots.flatMap(({ code, state }) =>
  state.players.map((player, sequenceIndex) => ({
    auction_code: code,
    id: player.id,
    sequence_index: sequenceIndex,
    name: player.name,
    role: player.role,
    team: player.team || null,
    nation: player.nation || null,
    tier: player.tier,
    number:
      player.number === undefined || player.number === null
        ? null
        : String(player.number),
    quote: Number(player.quote) || 0,
    highest_bid_participant_token: player.highestBid?.participantToken || null,
    highest_bid_participant_name: player.highestBid?.participantName || null,
    highest_bid_amount: player.highestBid?.amount ?? null,
  })),
);
const rosterPlayers = snapshots.flatMap(({ code, state }) =>
  state.participants.flatMap((participant) =>
    (participant.players || []).map((player) => ({
      auction_code: code,
      participant_token: participant.token,
      player_id: player.id,
      price: player.price,
    })),
  ),
);
const activity = snapshots.flatMap(({ code, state }) =>
  (state.activity || []).map((entry, position) => ({
    auction_code: code,
    position,
    name: entry.name,
    action: entry.action,
    amount: entry.amount ?? null,
  })),
);
const history = snapshots.flatMap(({ code, state }) =>
  (state.history || []).map((snapshot, position) => ({
    auction_code: code,
    position,
    snapshot,
  })),
);

await insert("auctions", auctions);
await insert("auction_participants", participants);
await insert("auction_players", players);
await insert("roster_players", rosterPlayers);
await insert("auction_activity", activity);
await insert("auction_history", history);

console.log(
  `Migrazione relazionale completata: ${auctions.length} aste, ${participants.length} partecipanti, ${players.length} giocatori, ${rosterPlayers.length} elementi rosa.`,
);
