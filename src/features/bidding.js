import { api } from "../api.js";
import { $, money, toast } from "../ui.js";

export function wireBidding({
  auction,
  session,
  setAuction,
  renderLive,
  dismissRosterWarning,
}) {
  const dismissWarning = $("#dismissRosterWarning");
  if (dismissWarning)
    dismissWarning.onclick = () => {
      dismissRosterWarning();
      $(".shared-roster-warning")?.remove();
    };

  const amount = $("#amount");
  if (amount) {
    const changeAmount = (step) => {
      amount.value = Math.max(+amount.min, +amount.value + step);
      $("#offerAmount").textContent = money(amount.value);
    };
    const wireAmountButton = (button, step) => {
      button.onclick = () => changeAmount(step);
      button.addEventListener(
        "touchend",
        (event) => {
          event.preventDefault();
          changeAmount(step);
        },
        { passive: false },
      );
      button.ondblclick = (event) => event.preventDefault();
    };
    wireAmountButton($("#plus"), 1);
    wireAmountButton($("#minus"), -1);
    amount.oninput = () =>
      ($("#offerAmount").textContent = money(amount.value));
    $("#bid").onclick = async () => {
      try {
        const response = await api(`/auctions/${session.code}/bid`, {
          method: "POST",
          body: JSON.stringify({
            token: session.token,
            amount: +amount.value,
          }),
        });
        setAuction(response.auction);
        renderLive();
        toast("Offerta registrata");
      } catch (error) {
        toast(error.message);
      }
    };
  }

  const bid = $("#bid");
  if (bid && !auction.canBid && auction.status === "live") {
    bid.disabled = true;
    bid.title = "Sei già in testa con l’ultima offerta";
  }
}
