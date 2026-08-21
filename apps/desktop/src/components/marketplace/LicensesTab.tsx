// apps/desktop/src/components/marketplace/LicensesTab.tsx
//
// Moved to the shared @ryu/marketplace package (one money-layer UI for desktop +
// web). This re-export keeps the desktop import path stable; the data path is
// supplied by <DesktopMarketplaceHost> (host.tsx).

export { LicensesTab as default } from "@ryu/marketplace/licenses-tab";
