export async function api(path, opts = {}) {
  const response = await fetch("/api" + path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Operazione non riuscita");
  return data;
}

export async function ownerApi(path, opts = {}) {
  const token = sessionStorage.getItem("fantabid-owner-token") || "";
  const response = await fetch("/api/owner" + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      "x-owner-token": token,
      ...(opts.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Operazione non riuscita");
  return data;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(Error("Impossibile leggere il file selezionato"));
    reader.readAsDataURL(file);
  });
}
