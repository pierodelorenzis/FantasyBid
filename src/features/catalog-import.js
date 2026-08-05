import { api, fileToBase64 } from "../api.js";
import { confirmDialog } from "../dialogs.js";
import { $, toast } from "../ui.js";

export function wireCatalogImport({ session, setAuction, renderAdmin }) {
  let selectedFile = null;
  const fileInput = $("#playerFile");
  fileInput.style.display = "none";

  const setImportBusy = (busy) => {
    $("#importPlayers").disabled = busy;
    $("#importLoader").hidden = !busy;
  };
  const uploadPlayers = async () => {
    const file = selectedFile || fileInput.files[0];
    const result = $("#importResult");
    if (!file) {
      fileInput.click();
      return;
    }
    if (
      !(await confirmDialog(
        "Sostituire il catalogo?",
        "Il nuovo file sostituirà completamente tutti i giocatori del catalogo attuale. L’operazione è disponibile solo quando l’asta non ha offerte o assegnazioni attive.",
        "Sostituisci catalogo",
      ))
    ) {
      selectedFile = null;
      fileInput.value = "";
      return;
    }
    result.textContent = `Caricamento di ${file.name}…`;
    setImportBusy(true);
    try {
      const response = await api(`/auctions/${session.code}/import`, {
        method: "POST",
        body: JSON.stringify({
          token: session.token,
          fileName: file.name,
          data: await fileToBase64(file),
        }),
      });
      selectedFile = null;
      setAuction(response.auction);
      renderAdmin();
      toast(`Importazione completata: ${response.count} giocatori`);
    } catch (error) {
      selectedFile = null;
      fileInput.value = "";
      result.textContent = "Errore importazione: " + error.message;
      toast(error.message);
    } finally {
      setImportBusy(false);
    }
  };

  $("#importPlayers").onclick = uploadPlayers;
  fileInput.onchange = () => {
    selectedFile = fileInput.files[0];
    uploadPlayers();
  };
}
