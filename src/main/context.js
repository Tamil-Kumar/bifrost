'use strict';
// Shared singletons, filled in by index.js at startup (keeps modules free of circular requires).
module.exports = {
  profile: null,     // { dir, portable, mode }
  settings: null,    // Settings
  db: null,          // Database
  registry: null,    // Registry
  search: null,      // SearchService
  adblock: null,     // AdBlock
  safety: null,      // Safety (dangerous-site warnings)
  sync: null,        // Sync (main/sync)
  updater: null,     // Updater (main/updater.js)
  extensions: null,  // Extensions
  downloads: null,   // Downloads
  permissions: null, // Permissions
  windows: null,     // windows module
  mainSession: null, // persist:main
  quitting: false,
};
