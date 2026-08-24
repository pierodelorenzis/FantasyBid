import { api } from "../api.js";
import { $, $$, money, toast } from "../ui.js";

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
      const offerAmount = $("#offerAmount");
      if (offerAmount) offerAmount.textContent = money(amount.value);
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
    amount.oninput = () => {
      const offerAmount = $("#offerAmount");
      if (offerAmount) offerAmount.textContent = money(amount.value);
    };
    const bidButton = $("#bid");
    const quickButtons = [...$$("[data-quick-bid]")];
    const pendingKey = `${session.code}:${session.token}`;
    const pending = pendingBids.has(pendingKey);
    setBidLoading(bidButton, pending);
    quickButtons.forEach(
      (button) => (button.disabled = pending || !auction.canBid),
    );
    const submitBid = async (bidAmount) => {
      if (!auction.canBid || pendingBids.has(pendingKey)) return;
      pendingBids.add(pendingKey);
      setBidLoading(bidButton, true);
      quickButtons.forEach((button) => (button.disabled = true));
      try {
        const response = await api(`/auctions/${session.code}/bid`, {
          method: "POST",
          body: JSON.stringify({
            token: session.token,
            amount: bidAmount,
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
        quickButtons.forEach(
          (button) => (button.disabled = !auction.canBid),
        );
      }
    };
    quickButtons.forEach((button) => {
      const submitQuickBid = () => {
        if (button.disabled || !auction.canBid) return;
        const lastValidBid = Number.isFinite(
          +auction.currentPlayer?.highestBid?.amount,
        )
          ? +auction.currentPlayer.highestBid.amount
          : 0;
        const quickAmount = lastValidBid + +button.dataset.quickBid;
        submitBid(quickAmount);
      };
      button.onclick = submitQuickBid;
      button.ondblclick = (event) => event.preventDefault();
    });
    bidButton.ondblclick = (event) => event.preventDefault();
    bidButton.addEventListener(
      "touchend",
      (event) => {
        event.preventDefault();
        bidButton.click();
      },
      { passive: false },
    );
    bidButton.onclick = () => submitBid(+amount.value);
  }

  const bid = $("#bid");
  if (bid && !auction.canBid && auction.status === "live") {
    bid.disabled = true;
    bid.title = "Sei già in testa con l’ultima offerta";
  }
}
