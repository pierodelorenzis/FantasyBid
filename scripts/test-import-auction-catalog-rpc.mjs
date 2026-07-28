import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseSecretKey) throw Error("Configura SUPABASE_URL e SUPABASE_SECRET_KEY nel file .env.");
const supabase = createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const code = `IMPORT${randomBytes(3).toString("hex").toUpperCase()}`;
const adminToken = `admin-${code}`;
const players = [
  { id: "new-1", name: "Giocatore alto", role: "POR", team: "Test", nation: "", number: "", quote: 25 },
  { id: "new-2", name: "Giocatore basso", role: "DIF", team: "Test", nation: "", number: "", quote: 5 },
];

try {
  const { error: auctionError } = await supabase.from("auctions").insert({
    code, name: "Test import atomico", budget: 100, status: "paused", total_slots: 2,
    remaining_slots: 2, current_index: 0,
    rules: { A: { minPrice: 10, increment: 1, cap: 50 }, B: { minPrice: 1, increment: 1, cap: 30 } },
    tier_settings: [{ name: "A", minQuote: 20, minPrice: 10, increment: 1, cap: 50 }, { name: "B", minQuote: 0, minPrice: 1, increment: 1, cap: 30 }],
  });
  if (auctionError) throw auctionError;
  const { error: adminError } = await supabase.from("auction_participants").insert({
    auction_code: code, token: adminToken, name: "Admin test", role: "admin", budget: 100, committed: 0,
  });
  if (adminError) throw adminError;
  const { error: oldPlayerError } = await supabase.from("auction_players").insert({
    auction_code: code, id: "old", sequence_index: 0, name: "Vecchio", role: "POR", tier: "B", quote: 1,
  });
  if (oldPlayerError) throw oldPlayerError;
  const { data: imported, error: importError } = await supabase.rpc("import_auction_catalog", {
    p_auction_code: code, p_admin_token: adminToken, p_players: players, p_history: [],
  });
  if (importError) throw importError;
  const [{ data: auction, error: auctionReadError }, { data: storedPlayers, error: playerReadError }] = await Promise.all([
    supabase.from("auctions").select("current_index, remaining_slots, player_order, order_by_role, version").eq("code", code).single(),
    supabase.from("auction_players").select("id, tier").eq("auction_code", code).order("sequence_index"),
  ]);
  if (auctionReadError || playerReadError) throw auctionReadError || playerReadError;
  if (imported.playerCount !== 2 || auction.current_index !== 0 || auction.remaining_slots !== 2 || auction.player_order !== null || auction.order_by_role || Number(auction.version) !== 2 || storedPlayers.map((player) => `${player.id}:${player.tier}`).join(",") !== "new-1:A,new-2:B") {
    throw Error("Il test dell’import atomico non ha prodotto lo stato atteso.");
  }
  console.log("Test import atomico superato: catalogo sostituito e fasce ricalcolate insieme.");
} finally {
  const { error } = await supabase.from("auctions").delete().eq("code", code);
  if (error) console.error("Impossibile rimuovere l’asta di test:", error.message);
}
