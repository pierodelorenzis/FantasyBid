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
const code = `JOIN${randomBytes(3).toString("hex").toUpperCase()}`;

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code,
    name: "Test ingresso atomico",
    budget: 100,
    status: "paused",
    total_slots: 1,
    remaining_slots: 1,
    current_index: 0,
    rules: {},
    tier_settings: [],
  });
  if (auctionError) throw auctionError;
  const { data: firstJoin, error: firstJoinError } = await supabase.rpc(
    "join_auction",
    { p_auction_code: code, p_name: "Partecipante test" },
  );
  if (firstJoinError) throw firstJoinError;
  const { data: secondJoin, error: secondJoinError } = await supabase.rpc(
    "join_auction",
    { p_auction_code: code, p_name: "partecipante TEST" },
  );
  if (secondJoinError) throw secondJoinError;
  const [{ data: auction, error: auctionReadError }, { data: participants, error: participantsReadError }] = await Promise.all([
    supabase.from("auctions").select("version").eq("code", code).single(),
    supabase.from("auction_participants").select("name, token, budget, committed").eq("auction_code", code),
  ]);
  if (auctionReadError) throw auctionReadError;
  if (participantsReadError) throw participantsReadError;
  if (
    !firstJoin.created ||
    secondJoin.created ||
    firstJoin.token !== secondJoin.token ||
    participants.length !== 1 ||
    participants[0].budget !== 100 ||
    participants[0].committed !== 0 ||
    Number(auction.version) !== 2
  ) {
    throw Error("Il test dell’ingresso atomico non ha prodotto lo stato atteso.");
  }
  console.log("Test ingresso atomico superato: partecipante e sessione coerenti.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
