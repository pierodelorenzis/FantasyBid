import { $ } from "../ui.js";

function download(url, name) {
  const anchor = document.createElement("a");
  anchor.href = "/api" + url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function wireExports(page, session) {
  if (page === "team")
    $("#exportTeam").onclick = () =>
      download(
        `/auctions/${session.code}/export/team?token=${session.token}`,
        "rosa.csv",
      );
  if (page === "teams" || page === "admin")
    $("#exportAll").onclick = () =>
      download(
        `/auctions/${session.code}/export/all?token=${session.token}`,
        "resoconto.csv",
      );
}
