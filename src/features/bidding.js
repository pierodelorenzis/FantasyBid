import { api } from "../api.js";
import { $, money, toast } from "../ui.js";

const pendingBids = new Set();

function setBidLoading(button, loading) {
  if (!button) return;
  if (loading) button.disabled = true;
  button.classList.toggle("loading", loading);
  button.setAttribute("aria-busy", String(loading));
  if (loading)
    button.innerHTML = '<span class="bid-loader" aria-hidden="true"></span> Registrazione…';
}

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
    const bidButton = $("#bid");
    const pendingKey = `${session.code}:${session.token}`;
    setBidLoading(bidButton, pendingBids.has(pendingKey));
    bidButton.ondblclick = (event) => event.preventDefault();
    bidButton.addEventListener(
      "touchend",
      (event) => {
        event.preventDefault();
        bidButton.click();
      },
      { passive: false },
    );
    bidButton.onclick = async () => {
      if (pendingBids.has(pendingKey)) return;
      pendingBids.add(pendingKey);
      setBidLoading(bidButton, true);
      try {
        const response = await api(`/auctions/${session.code}/bid`, {
          method: "POST",
          body: JSON.stringify({
            token: session.token,
            amount: +amount.value,
          }),
        });
        setAuction(response.auction);
        pendingBids.delete(pendingKey);
        renderLive();
        toast("Offerta registrata");
      } catch (error) {
        toast(error.message);
        pendingBids.delete(pendingKey);
        setBidLoading(bidButton, false);
        bidButton.innerHTML = `Fai la tua offerta <span id="offerAmount">${money(amount.value)}</span>`;
        bidButton.disabled = !auction.canBid;
      }
    };
  }

  const bid = $("#bid");
  if (bid && !auction.canBid && auction.status === "live") {
    bid.disabled = true;
    bid.title = "Sei già in testa con l’ultima offerta";
  }
}
