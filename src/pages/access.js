import { api } from "../api.js";
import { adminLinkCreatedDialog } from "../dialogs.js";
import { $, renderIcons, toast } from "../ui.js";

export function createAccessPages({ app, stop, saveSession, loadAuction }) {
  function landing() {
    stop();
    history.replaceState(null, "", "/");
    app.innerHTML = `<main class="landing"><nav class="land-nav"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><button id="showJoin" class="ghost">Entra in un'asta <i data-lucide="arrow-right"></i></button></nav><section class="hero"><p class="eyebrow">L'ASTA DEL FANTACALCIO, SEMPLIFICATA</p><h1>Tutta la tua lega.<br><em>Un'unica asta.</em></h1><p class="lead">Crea una stanza, condividi il link e gestisci ogni rilancio in tempo reale.</p><button class="primary big" id="showCreate">Crea una nuova asta <i data-lucide="arrow-right"></i></button></section><footer class="landing-footer"><div class="features"><span><i data-lucide="circle-check"></i> Nessuna registrazione</span><span><i data-lucide="sliders-horizontal"></i> Regole personalizzabili</span><span><i data-lucide="download"></i> Export CSV incluso</span></div><div class="landing-credit"><span>Made with love by Pedro.</span><a class="tip-link" href="https://www.paypal.me/pierodelorenzis" target="_blank" rel="noopener noreferrer"><i data-lucide="heart"></i> Lascia un Tip</a></div></footer></main>`;
    renderIcons();
    $("#showCreate").onclick = createForm;
    $("#showJoin").onclick = joinForm;
  }

  function createForm() {
    app.innerHTML = `<main class="auth"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><section class="auth-card"><button class="back"><i data-lucide="arrow-left"></i> Indietro</button><p class="eyebrow">AMMINISTRATORE</p><h1>Crea la tua asta</h1><p>Imposta i dettagli iniziali. Potrai modificare le regole dalla dashboard.</p><form id="create"><label>Nome della lega<input name="name" required placeholder="es. Amici del calcetto"></label><label>Il tuo nome<input name="adminName" required placeholder="es. Marco Rossi"></label><label>Crediti iniziali per squadra<input name="budget" type="number" value="300" min="1" required></label><button class="primary">Crea asta <i data-lucide="arrow-right"></i></button></form></section></main>`;
    renderIcons();
    $(".back").onclick = landing;
    $("#create").onsubmit = async (event) => {
      event.preventDefault();
      try {
        const data = await api("/auctions", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
        });
        saveSession({
          code: data.code,
          token: data.adminToken,
          role: "admin",
          name: data.adminName,
        });
        await adminLinkCreatedDialog(data.code, data.adminToken);
        await loadAuction();
      } catch (error) {
        toast(error.message);
      }
    };
  }

  function joinForm() {
    app.innerHTML = `<main class="auth"><a class="brand"><span class="brand-mark">F</span><span class="brand-name">Fanta<span>Bid</span></span></a><section class="auth-card"><button class="back"><i data-lucide="arrow-left"></i> Indietro</button><p class="eyebrow">PARTECIPANTE</p><h1>Entra nell'asta</h1><p>Inserisci il codice che ti ha inviato l'amministratore.</p><form id="join"><label>Codice asta<input name="code" required maxlength="6" placeholder="ABC123" style="text-transform:uppercase"></label><label>Il tuo nome<input name="name" required placeholder="es. Luca Gallo"></label><button class="primary">Entra nell'asta <i data-lucide="arrow-right"></i></button></form></section></main>`;
    renderIcons();
    $(".back").onclick = landing;
    $("#join").onsubmit = async (event) => {
      event.preventDefault();
      const form = Object.fromEntries(new FormData(event.target));
      try {
        const data = await api("/auctions/" + form.code.toUpperCase() + "/join", {
          method: "POST",
          body: JSON.stringify({ name: form.name }),
        });
        saveSession({
          code: form.code.toUpperCase(),
          token: data.token,
          role: "participant",
          name: form.name,
        });
        await loadAuction();
      } catch (error) {
        toast(error.message);
      }
    };
  }

  return { createForm, joinForm, landing };
}
