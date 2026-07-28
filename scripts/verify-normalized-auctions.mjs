import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) {
  throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const fetchAll = async (table, columns) => {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(start, start + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
};
const countByAuction = (rows) =>
  rows.reduce((counts, row) => {
    counts.set(row.auction_code, (counts.get(row.auction_code) || 0) + 1);
    return counts;
  }, new Map());

const { data: snapshots, error: snapshotError } = await supabase
  .from("auction_snapshots")
  .select("code, state, version");
if (snapshotError) throw snapshotError;

const [auctions, participants, players, rosterPlayers, activity, history] =
  await Promise.all([
    fetchAll("auctions", "code, status, current_index, remaining_slots, version"),
    fetchAll("auction_participants", "auction_code"),
    fetchAll("auction_players", "auction_code"),
    fetchAll("roster_players", "auction_code"),
    fetchAll("auction_activity", "auction_code"),
    fetchAll("auction_history", "auction_code"),
  ]);

const normalizedByCode = new Map(auctions.map((auction) => [auction.code, auction]));
const normalizedCounts = {
  participants: countByAuction(participants),
  players: countByAuction(players),
  rosterPlayers: countByAuction(rosterPlayers),
  activity: countByAuction(activity),
  history: countByAuction(history),
};
const mismatches = [];
for (const { code, state, version } of snapshots) {
  const auction = normalizedByCode.get(code);
  if (!auction) {
    mismatches.push(`${code}: asta mancante`);
    continue;
  }
  const expected = {
    participants: state.participants.length,
    players: state.players.length,
    rosterPlayers: state.participants.reduce(
      (total, participant) => total + (participant.players || []).length,
      0,
    ),
    activity: (state.activity || []).length,
    history: (state.history || []).length,
  };
  const fieldsMatch =
    auction.status === state.status &&
    auction.current_index === state.currentIndex &&
    auction.remaining_slots === state.remainingSlots &&
    Number(auction.version) === Number(version);
  const countsMatch = Object.entries(expected).every(
    ([key, value]) => (normalizedCounts[key].get(code) ?? 0) === value,
  );
  if (!fieldsMatch || !countsMatch) {
    mismatches.push(
      `${code}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(Object.fromEntries(Object.keys(expected).map((key) => [key, normalizedCounts[key].get(code) || 0])))}.`,
    );
  }
}

if (mismatches.length) {
  console.error("Verifica relazionale non superata.");
  mismatches.forEach((message) => console.error(message));
  process.exitCode = 1;
} else {
  console.log(
    `Verifica relazionale superata: ${snapshots.length} aste e tutti i conteggi coincidono con gli snapshot.`,
  );
}
