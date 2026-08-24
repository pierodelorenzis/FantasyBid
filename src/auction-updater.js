import { $ , money } from "./ui.js";

export function createAuctionUpdater({
  getAuction,
  setAuction,
  getActivePage,
  render,
}) {
  return function applyAuctionUpdate(nextAuction) {
    const currentPlayerId = getAuction()?.currentPlayer?.id;
    const nextPlayerId = nextAuction?.currentPlayer?.id;
    const samePlayer =
      currentPlayerId != null &&
      String(currentPlayerId) === String(nextPlayerId);
    setAuction(nextAuction);
    if (getActivePage() !== "live") return;
    const activityScroll = $(".auction-sidebar .recent")?.scrollTop || 0;
    const pendingAmount = samePlayer ? $("#amount")?.value : null;
    const wasEditingAmount =
      samePlayer && document.activeElement?.id === "amount";
    render("live");
    const activityTable = $(".auction-sidebar .recent");
    if (activityTable) activityTable.scrollTop = activityScroll;
    const amountInput = $("#amount");
    if (amountInput && pendingAmount && Number.isFinite(+pendingAmount)) {
      amountInput.value = Math.max(+amountInput.min, +pendingAmount);
      const offerAmount = $("#offerAmount");
      if (offerAmount) offerAmount.textContent = money(amountInput.value);
      if (wasEditingAmount) amountInput.focus();
    }
  };
}
