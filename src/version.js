export async function showDeployedVersion() {
  const badge = document.querySelector("#appVersion");
  if (!badge) return;
  try {
    const response = await fetch("/api/version");
    if (!response.ok) return;
    const { version } = await response.json();
    badge.textContent = `v${version}`;
    badge.hidden = false;
  } catch {
    badge.hidden = true;
  }
}
