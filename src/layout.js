import { confirmDialog } from "./dialogs.js";
import { auctionUrl } from "./routes.js";
import { $, $$, initials, renderIcons, toast } from "./ui.js";

export function createAuctionLayout({
  app,
  getSession,
  getAuction,
  setSession,
  forgetSession,
  landing,
  renderPage,
  wirePage,
}) {
  let activePage = "live";
  let mobileMenuOpen = false;

  function navigation(page) {
    const session = getSession();
    const admin = session.role === "admin";
    return `<aside><div class="menu-brand"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><button id="closeMobileMenu" class="mobile-menu-close" aria-label="Chiudi menu"><i data-lucide="x"></i></button></div><button class="nav ${page === "live" ? "active" : ""}" data-page="live"><i data-lucide="gavel"></i> Asta live</button>${admin ? `<button class="nav ${page === "teams" ? "active" : ""}" data-page="teams"><i data-lucide="users"></i> Squadre partecipanti</button><button class="nav ${page === "admin" ? "active" : ""}" data-page="admin"><i data-lucide="settings"></i> Gestione asta</button>` : `<button class="nav ${page === "team" ? "active" : ""}" data-page="team"><i data-lucide="shirt"></i> La mia squadra</button>`}<div class="side-user"><div class="avatar">${initials(session.name)}</div><div><b>${session.name}</b><small>${admin ? "Admin" : "Partecipante"}</small></div><button id="logout" aria-label="Esci dall'asta"><i data-lucide="log-out"></i></button></div></aside>`;
  }

  function render(page = "live") {
    activePage = page;
    const auction = getAuction();
    const session = getSession();
    app.innerHTML = `<div class="shell ${mobileMenuOpen ? "menu-open" : ""}">${navigation(page)}<section class="content"><header><button id="mobileMenu" class="mobile-menu" aria-label="Apri menu"><i data-lucide="menu"></i></button><span class="crumb">${auction.name} <b>·</b> Codice <strong>${auction.code}</strong></span>${session.role === "admin" ? '<button id="share" class="ghost">Condividi link <i data-lucide="share-2"></i></button>' : ""}</header><div class="page">${renderPage(page)}</div></section></div>`;
    renderIcons();
    $$(".nav").forEach(
      (button) =>
        (button.onclick = () => {
          mobileMenuOpen = false;
          render(button.dataset.page);
        }),
    );
    $("#mobileMenu").onclick = () => {
      mobileMenuOpen = !mobileMenuOpen;
      $(".shell").classList.toggle("menu-open", mobileMenuOpen);
    };
    $("#closeMobileMenu").onclick = () => {
      mobileMenuOpen = false;
      $(".shell").classList.remove("menu-open");
    };
    $("#logout").onclick = async () => {
      if (
        !(await confirmDialog(
          "Uscire dall'asta?",
          "La sessione verrà rimossa solo da questo dispositivo. Potrai rientrare usando il codice dell'asta.",
          "Esci dall'asta",
        ))
      )
        return;
      forgetSession(session.code);
      setSession(null);
      landing();
    };
    if ($("#share"))
      $("#share").onclick = () => {
        navigator.clipboard?.writeText(auctionUrl(auction.code));
        toast("Link copiato: condividilo con la lega");
      };
    wirePage(page);
  }

  return {
    getActivePage: () => activePage,
    render,
  };
}
