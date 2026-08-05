import { createAuctionLifecycle } from "./src/auction-lifecycle.js";
import { createAuctionUpdater } from "./src/auction-updater.js";
import { createAuctionLayout } from "./src/layout.js";
import { auctionPath } from "./src/routes.js";
import { createAuctionRealtime } from "./src/realtime.js";
import { createAccessPages } from "./src/pages/access.js";
import { createOwnerPage } from "./src/pages/owner.js";
import { renderTeamPage } from "./src/pages/team.js";
import { renderTeamsPage } from "./src/pages/teams.js";
import { renderAdminPage } from "./src/pages/admin.js";
import { createLivePageRenderer } from "./src/pages/live.js";
import { wireExports } from "./src/features/exports.js";
import { wireAdminAccess } from "./src/features/admin-access.js";
import { wireTeamManagement } from "./src/features/teams.js";
import { wireTierManagement } from "./src/features/tiers.js";
import { wireCatalogImport } from "./src/features/catalog-import.js";
import { createCatalogFeature } from "./src/features/catalog.js";
import { wireAuctionSession } from "./src/features/auction-session.js";
import { wireActivityManagement } from "./src/features/activity.js";
import { wireBidding } from "./src/features/bidding.js";
import {
  persistSession,
  removeStoredSession,
  storedSessions,
} from "./src/session-store.js";
import { $, toast } from "./src/ui.js";
import { showDeployedVersion } from "./src/version.js";

const app = $("#app");
let session = null,
  auction = null;
function save(s) {
  session = persistSession(s);
  history.replaceState(null, "", auctionPath(session.code));
}
function forgetSession(code) {
  removeStoredSession(code);
}
function stop() {
  realtime.stop();
}
let auctionLifecycle;
const ownerDashboard = createOwnerPage({ app, stop });
const { createForm, joinForm, landing } = createAccessPages({
  app,
  stop,
  saveSession: save,
  loadAuction: () => auctionLifecycle.load(),
});
const livePage = createLivePageRenderer();
const catalogFeature = createCatalogFeature();
const layout = createAuctionLayout({
  app,
  getSession: () => session,
  getAuction: () => auction,
  setSession: (nextSession) => (session = nextSession),
  forgetSession,
  landing,
  renderPage: (page) =>
    page === "live"
      ? livePage.render({ auction, session, participant: me() })
      : page === "team"
        ? renderTeamPage({ auction, participant: me(), sessionName: session.name })
        : page === "teams"
          ? renderTeamsPage(auction)
          : renderAdminPage(auction),
  wirePage: wire,
});
const render = layout.render;
const applyAuctionUpdate = createAuctionUpdater({
  getAuction: () => auction,
  setAuction: (nextAuction) => (auction = nextAuction),
  getActivePage: layout.getActivePage,
  render,
});
const realtime = createAuctionRealtime({
  getSession: () => session,
  onAuction: applyAuctionUpdate,
  onInvalid: () => auctionLifecycle.invalidate(),
});
auctionLifecycle = createAuctionLifecycle({
  getSession: () => session,
  setSession: (nextSession) => (session = nextSession),
  setAuction: (nextAuction) => (auction = nextAuction),
  getActivePage: layout.getActivePage,
  saveSession: save,
  forgetSession,
  stopRealtime: stop,
  startRealtime: () => realtime.start(),
  render,
  landing,
});
function wire(page) {
  wireExports(page, session);
  if (page === "live") {
    wireAuctionSession({
      auction,
      session,
      setAuction: (nextAuction) => (auction = nextAuction),
      renderLive: () => render("live"),
    });
    wireActivityManagement({
      session,
      setAuction: (nextAuction) => (auction = nextAuction),
      renderLive: () => render("live"),
    });
    wireBidding({
      auction,
      session,
      setAuction: (nextAuction) => (auction = nextAuction),
      renderLive: () => render("live"),
      dismissRosterWarning: livePage.dismissRosterWarning,
    });
  }
  if (page === "teams") {
    wireTeamManagement({
      session,
      setAuction: (nextAuction) => (auction = nextAuction),
      renderTeams: () => render("teams"),
    });
  }
  if (page === "admin") {
    wireAdminAccess({
      auction,
      session,
      stopRealtime: stop,
      saveSession: save,
      loadAuction: () => auctionLifecycle.load(),
      renderAdmin: () => render("admin"),
    });
    wireTierManagement({
      session,
      setAuction: (nextAuction) => (auction = nextAuction),
      renderAdmin: () => render("admin"),
    });
    wireCatalogImport({
      session,
      setAuction: (nextAuction) => (auction = nextAuction),
      renderAdmin: () => render("admin"),
    });
    catalogFeature.wire({
      auction,
      session,
      setAuction: (nextAuction) => (auction = nextAuction),
      renderLive: () => render("live"),
    });
  }
}
function me() {
  return (
    auction.participants.find((x) => x.token === session.token) || {
      budget: auction.budget,
      players: [],
      committed: 0,
    }
  );
}
window.addEventListener("load", async () => {
  showDeployedVersion();
  const params = new URLSearchParams(location.search);
  const pathMatch = location.pathname.match(/^\/([A-Z0-9]{6})\/?$/i);
  const code = (pathMatch?.[1] || params.get("asta") || "").toUpperCase();
  const fragment = new URLSearchParams(location.hash.slice(1));
  const adminToken = fragment.get("admin");
  if (params.has("owner")) return ownerDashboard();
  if (!code) return landing();
  history.replaceState(null, "", auctionPath(code));
  if (adminToken) {
    try {
      await auctionLifecycle.activateAdminLink(code, adminToken);
      toast("Accesso amministratore verificato");
      return;
    } catch (error) {
      toast(error.message);
    }
  }
  session = storedSessions[code] || null;
  if (!session) {
    joinForm();
    $("#join [name=code]").value = code;
  } else auctionLifecycle.load();
});
