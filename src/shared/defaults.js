/* Bifrost browser — settings defaults, command list and keyboard accelerators.
   Shared by the main process (CommonJS) and every page (window.WBDefaults). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WBDefaults = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_ENGINES = [
    { id: 'google', name: 'Google', keyword: 'g', url: 'https://www.google.com/search?q=%s', suggest: 'google' },
    { id: 'ddg', name: 'DuckDuckGo', keyword: 'd', url: 'https://duckduckgo.com/?q=%s', suggest: 'duckduckgo' },
    { id: 'youtube', name: 'YouTube', keyword: 'yt', url: 'https://www.youtube.com/results?search_query=%s', suggest: '' },
    { id: 'github', name: 'GitHub', keyword: 'gh', url: 'https://github.com/search?q=%s&type=repositories', suggest: '' },
    { id: 'wikipedia', name: 'Wikipedia', keyword: 'w', url: 'https://en.wikipedia.org/w/index.php?search=%s', suggest: '' },
    { id: 'reddit', name: 'Reddit', keyword: 'r', url: 'https://www.reddit.com/search/?q=%s', suggest: '' },
    { id: 'mdn', name: 'MDN', keyword: 'mdn', url: 'https://developer.mozilla.org/en-US/search?q=%s', suggest: '' },
  ];

  // Sites whose own single-key shortcuts Vim keys would take over.
  const VIM_EXCLUDED = ['youtube.com', 'twitch.tv', 'netflix.com', 'open.spotify.com', 'x.com', 'twitter.com', 'reddit.com', 'github.com',
    'mail.google.com', 'docs.google.com', 'drive.google.com', 'calendar.google.com', 'meet.google.com', 'figma.com', 'notion.so',
    'app.slack.com', 'discord.com', 'outlook.live.com', 'outlook.office.com', 'lichess.org', 'chess.com'];

  const DEFAULTS = {
    appearance: {
      theme: 'mocha',            // a theme key, 'auto' (follow system) or 'custom'
      darkTheme: 'mocha',
      lightTheme: 'latte',
      customTheme: null,         // palette object when theme === 'custom'
      useCustomAccent: false,
      accent: '#cba6f7',
      workspaceAccents: true,    // each workspace's color tints the UI
      font: '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif',
      monoFont: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      uiScale: 1,
      radius: 10,
      density: 'comfortable',    // compact | comfortable | spacious
      tabLayout: 'vertical',     // vertical | horizontal
      sidebarSide: 'left',
      sidebarWidth: 264,
      sidebarCollapsed: false,
      sidebarAutoHide: false,    // collapse to a thin strip and expand on hover
      topbarAutoHide: false,     // the toolbar (and bookmarks bar, and horizontal tabs) slide down on hover
      // Auto-hiding bars: how long to wait before they slide in and out (ms), how fast they move (ms),
      // and how wide the strip at the window edge that brings them in is (px).
      flyout: { showDelay: 0, hideDelay: 300, duration: 220, edge: 6 },
      horizontalTabMinWidth: 96,
      horizontalTabMaxWidth: 232,
      showBookmarksBar: true,
      bookmarksBar: {
        showOtherBookmarks: true,  // the "Other bookmarks" button at the end of the bar
        labels: 'all',             // all | folders (bookmarks show just their icon) | none (icons only)
      },
      showStatusBubble: true,
      showTabPreviews: true,
      tabPreviewDelay: 520,      // ms of hovering a tab before its preview shows
      pageFrame: true,           // the rounded frame (padding, corners, outline) around web pages; off = edge to edge
      shadows: 'normal',         // none | subtle | normal | strong
      menuStyle: 'solid',        // solid | glass (see-through, blurred menus, popovers and dialogs)
      activeTab: 'card',         // card | rail | fill | outline: how the current tab stands out
      loadingStyle: 'both',      // both | spinner (on the tab) | bar (over the page) | none
      toastPosition: 'bottom',   // bottom | top | bottom-right
      scrollbars: 'thin',        // thin | normal | hidden (in Bifrost's own pages and panels)
      chrome: 'aurora',          // the window around the page: aurora (lit with the theme's colors) | gradient | flat
      blend: 'window',           // the sidebar and toolbar: window (the window background above) | page (the color of the page you're on, no edge between them) | blur (a blurred picture of the page)
      blendBlur: 40,             // how blurred, with "blur" (px)
      texture: true,             // a fine grain on the window around the page
      webTheme: 'browser',       // websites light or dark: browser (like Bifrost's theme, the default, as in Firefox) | system | light | dark
      // show: path | host | full; position: center (middle of the toolbar) | window (middle of the window) | fill (between the buttons)
      address: { show: 'path', centered: false, position: 'center' },
      showTabCloseButtons: 'hover', // always | hover | never
      showWorkspaceStrip: true,
      compactToolbar: false,
      // What sits where. Items come from LAYOUT_ITEMS below; "spacer" and "divider" may repeat.
      toolbar: ['back', 'forward', 'reload', 'address', 'adblock', 'extensions', 'downloads', 'menu'],
      sidebarTop: ['workspace', 'spacer', 'sidebar'],
      sidebarBottom: ['spaces', 'bookmarks', 'history', 'settings'],
      // Corner rounding per kind of element, in px. -1 follows "radius" above.
      shape: { buttons: -1, tabs: -1, address: -1, menus: -1, page: -1, tiles: -1 },
      // Sizes and spacing, in px. -1 means automatic (from "density").
      sizes: {
        toolbarHeight: -1, button: -1, icon: -1, buttonGap: -1, address: -1,
        tab: -1, tabGap: -1, sidebarPadding: -1, pageGap: -1, bookmarksBar: -1, bookmarkPadding: -1,
      },
      useSystemTitleBar: false,
      windowMaterial: 'none',    // none | mica | acrylic (Windows 11)
      customCss: '',
      newTab: {
        speedDialFolder: '',     // bookmark folder id; '' = a folder named "Speed Dial", else the bookmarks bar
        columns: 6,
        tileSize: 'medium',      // small | medium | large
        showClock: true,
        showGreeting: true,
        showSearch: true,
        showSpeedDial: true,
        greetingName: '',        // "Good evening, <name>"
        customizeButton: true,   // the customize button in the bottom corner (right-clicking the page does the same)
        moduleMenuButton: true,  // the ⋮ button a module shows when you point at it (right-clicking a module does the same)
        clock: {
          hours: 'auto',         // auto (the system's choice) | 12 | 24
          seconds: false,
          ampm: true,            // show AM/PM on a 12-hour clock
          ampmSize: 'small',     // small | medium | large (as big as the time)
          blink: false,          // blinking colons
          date: 'none',          // none | long ("Saturday, October 17") | short ("Sat, Oct 17") | numeric
          font: 'ui',            // ui | thin | display | rounded | serif | mono | custom
          customFont: '',
          size: 100,             // percent
          weight: 300,
          spacing: -4,           // letter spacing, hundredths of an em
          color: 'text',         // text | accent | gradient (the theme's two accents) | custom
          customColor: '#ffffff',
          position: 'center',    // center (above the search box) | top-left | top | top-right | left | right | bottom-left | bottom | bottom-right
        },
        // Modules on the page, in order: [{ id, place }]. id: one of NTP_MODULES below; place: a page area
        // (above, below, left, right, top-left, top, top-right, bottom-left, bottom, bottom-right).
        modules: [],
        moduleCfg: {
          weather: { city: '', units: 'auto' },          // units: auto | c | f
          countdown: { title: '', date: '' },            // date: YYYY-MM-DD or YYYY-MM-DDTHH:MM
          topsites: { count: 6 },
          recent: { count: 5 },
          folder: { id: '' },
          calendar: { weekStart: 'auto' },               // auto | sunday | monday
        },
        background: 'gradient',  // none | gradient | image
        image: '',               // file path or URL
        imageDim: 0.35,
        imageBlur: 0,
      },
    },
    animations: {
      enabled: true,
      style: 'smooth',           // subtle | smooth | playful | snappy (see ANIM_STYLES)
      speed: 1,                  // multiplier for every duration
      respectReducedMotion: true,
      buttons: true,             // buttons press in when clicked
      internalPages: true,       // Settings sections and other Bifrost pages slide in
      bookmarksBar: true,        // bookmarks bar items arrive one after another
      ripple: false,             // a ripple spreads from where you click a button
      swipe: true,               // the back/forward swipe arrow sliding away
      tabOpenClose: true,
      tabSwitch: true,
      tabDrag: true,
      tabHover: true,
      loadingIndicator: true,
      workspaceSwitch: true,
      splitView: true,
      launcher: true,
      menus: true,
      panels: true,
      sidebar: true,
      pageTransitions: true,
      toasts: true,
      newTabPage: true,
    },
    tabs: {
      newTabPosition: 'afterActive', // afterActive | end
      newTabOpensLauncher: true,     // Ctrl+T and + open the launcher; pick something to open it in a new tab
      closeWindowWithLastTab: false,
      newTabPage: 'speeddial',       // speeddial | blank | url
      newTabUrl: '',
      activateOnClose: 'previous',   // previous | right | left
      confirmCloseWindow: true,
      middleClickCloses: true,
      doubleClickToClose: false,
      showAudioIndicator: true,
      restoreOnStartup: 'last',      // last | newtab | urls
      startupUrls: [],
      homeUrl: '',
      // Ctrl+Tab: 'order' goes through tabs left to right like Chrome. 'recent': a quick Ctrl+Tab flips
      // between your two most recent tabs, and holding Ctrl for a moment first (ctrlTabHoldMs) goes through
      // tabs in order. 'mru': keeps going back through tabs in the order you used them while Ctrl is held.
      ctrlTab: 'recent',
      ctrlTabHoldMs: 350,
    },
    // Memory and speed. A profile sets everything in PERF_PRESETS below; "custom" uses performance.custom.
    performance: {
      profile: 'balanced',       // max | balanced | saver | custom
      custom: {
        sleepEnabled: true, sleepMinutes: 30, sleepPinned: false, sleepAudible: false, sleepOtherSpaces: true,
        animations: true, lowVisuals: false, tabPreviews: true, backgroundThrottling: true,
        historyIndexSize: 10000, rendererLimit: 0,
      },
    },
    workspaces: {
      showSwitcher: true,
      switchOnDrop: true,
    },
    split: {
      orientation: 'row',            // row (side by side) | column (stacked)
      gap: 6,
    },
    search: {
      engines: DEFAULT_ENGINES,
      defaultEngine: 'google',
      suggestions: true,
      suggestionProvider: 'google',  // google | duckduckgo | none
      openInNewTab: false,
    },
    launcher: {
      // Every setting of the Waypoint launcher extension (Settings → Launcher). Its ranking engine is
      // shared/engine.js. Where Waypoint and Bifrost behaved differently, the default is Bifrost's.
      // Ranking
      wMatch: 1.0, wVisits: 0.5, wRecency: 0.35,
      recencyHalfLifeDays: 14, visitsSaturation: 50,
      fuzzy: true, minScore: 0.05, maxResults: 10,
      searchRowPosition: 'auto', autoThreshold: 0.45, suggestionDecay: 0.08,
      historyIndex: 0,               // history pages searched instantly; 0 = as the performance profile says
      // Sources
      sources: {
        bookmarks: { enabled: true, weight: 1.6, max: 8 },
        tabs: { enabled: true, weight: 1.2, max: 5, currentWindowOnly: false },
        history: { enabled: true, weight: 1.0, max: 8 },
        commands: { enabled: true, weight: 0.9, max: 4 },
        suggestions: { enabled: true, weight: 0.55, max: 5 },
      },
      prefixes: { bookmarks: '*', history: '^', tabs: '%', commands: '>', suggestions: '?' },
      boosts: { domains: [], folders: [] },
      bookmarkFolders: { mode: 'all', ids: [] },
      // Keys & behavior
      openMode: 'overlay',           // overlay (over the page, near the top) | window (a centered window)
      windowHeight: 540,             // px, as a centered window
      toolbarButton: 'same',         // same (as the shortcut) | popup (under the button)
      // Where Enter opens the result, by the keys held with it (a click with them does the same), and a
      // middle-click: current | newtab | background | window | private | split (next to this tab, in its
      // split if it's in one) | copy (its address) | web (search the web for what you typed instead) | none
      open: { enter: 'newtab', shift: 'current', ctrl: 'split', alt: 'background', ctrlShift: 'window', altShift: 'private', ctrlAlt: 'web', middle: 'background' },
      // The launcher's other keys (shared/launcher-settings.js KEY_ACTIONS), as accelerators.
      keys: {
        next: ['Down', 'Tab', 'Ctrl+N', 'Ctrl+J'], prev: ['Up', 'Shift+Tab', 'Ctrl+P', 'Ctrl+K'],
        pageDown: ['PageDown'], pageUp: ['PageUp'], first: ['Ctrl+Home'], last: ['Ctrl+End'],
        close: ['Escape'], clear: [], remove: ['Shift+Delete'], copy: ['Ctrl+Shift+C'], settings: ['Ctrl+Comma'],
      },
      quickPick: 'alt',              // alt | ctrl | none: Alt+1…9 opens the first…ninth result
      switchToOpenTab: true,         // a bookmark or history result that's open in a tab switches to it
      emptyState: 'bookmarks',       // bookmarks | tabs | history | none
      escClears: false,              // Esc empties the box first, then closes
      typingDelayMs: 0,              // wait after a key before searching (0: search as you type)
      suggestDelayMs: 90,            // web suggestions and older history wait this long after the last key
      omnibox: true,                 // the address bar shows the launcher's results as you type
      rememberQuery: false,          // it opens with what you last typed in it (all selected)
      backgroundStaysOpen: false,    // opening a result in a background tab leaves it open (to open several)
      hoverSelects: true,            // pointing at a result selects it
      wrap: true,                    // moving past the last result goes to the first, and back
      closeOnBlur: false,            // switching to another app closes it (clicking outside it always does)
      // Appearance
      theme: 'browser',              // browser (like Bifrost) | auto (Mocha or Latte, like the system) | a theme
      useCustomAccent: false,
      accent: '#cba6f7',
      font: '',                      // '' = the browser's
      fontSize: -1,                  // px; -1 = the browser's interface size
      width: 680,
      top: 14,                       // percent of the window height
      dim: 0.35,
      blur: true,
      radius: -1,                    // px; -1 = like menus and dialogs
      density: 'comfortable',        // comfortable | compact (one line per result)
      favicons: 'browser',           // browser (Bifrost's icon cache) | google | duckduckgo | none (source icons)
      showUrls: true,
      showFolders: true,
      showBadges: true,
      showHints: true,
      showScores: false,
      highlight: 'accent',           // accent | bold | none: how the letters you typed show in results
      clearButton: true,             // a × in the box while there's text in it
      animations: true,              // animate opening and the selection
      customCss: '',
    },
    privacy: {
      adblock: {
        enabled: true,
        cosmetic: true,
        youtubeSkip: true,           // skip YouTube video ads as they start
        youtubeFilters: false,       // on YouTube, the lists' page scripts and blocking of YouTube's own ad requests (can stop YouTube loading)
        lists: { ads: true, tracking: true, annoyances: false, cookieNotices: false },
        customFilters: '',
        updateHours: 24,
        allowlist: [],
      },
      // Warn before opening pages known for phishing, malware or scams (main/safety.js).
      dangerousSites: true,
      httpsOnly: false,
      doNotTrack: false,
      globalPrivacyControl: true,
      clearOnExit: { history: false, cookies: false, cache: false, downloads: false },
      sendReferrer: true,
    },
    downloads: {
      folder: '',                    // '' = the system Downloads folder
      askWhereToSave: false,
      showOnStart: true,
    },
    keyboard: {
      shortcuts: {},                 // command id -> array of accelerators (overrides)
      vim: {
        enabled: false,              // off unless you turn it on: single letters then belong to the page
        hintChars: 'asdfghjkl',
        scrollStep: 70,
        smoothScroll: true,
        // Sites with keyboard shortcuts of their own (K, F, J… on YouTube) keep their keys.
        excludedSites: VIM_EXCLUDED.slice(),
        keys: {},                    // vim action -> key sequence (overrides)
      },
    },
    // Touchpad gestures. swipe: two fingers sideways go back (left to right) and forward (right to left);
    // swipeDistance: how far (px) before letting go counts; swipeReverse: the other way round.
    gestures: { swipe: true, swipeDistance: 120, swipeReverse: false },
    // Translating pages (Google Translate's website translator). target: a Google Translate code, or ''
    // for the language Windows uses; offer: a Translate button in the address bar on pages in another one.
    translate: { offer: true, target: '', neverFor: [] },
    extensions: {
      pinned: [],                    // extension ids shown in the toolbar
      allowWebStore: true,
      popupsInWindow: true,          // toolbar popups drawn inside the window under their button (false: separate windows)
    },
    advanced: {
      spellcheck: true,
      spellcheckLanguages: ['en-US'],
      userAgentMode: 'chrome',       // chrome | electron | custom
      customUserAgent: '',
      hardwareAcceleration: true,
      smoothScrolling: true,
      middleClickAutoscroll: true,   // Windows: click the mouse wheel and move the mouse to scroll
      proxy: { mode: 'system', rules: '', bypass: '' },
      siteUserAgents: [
        // Google's sign-in turns away a Chromium that claims to be Chrome (and Firefox look-alikes); it
        // accepts one that says it's an embedded Chromium. See main/useragent.js.
        { host: 'accounts.google.com', ua: 'embedded' },
      ],
      waylandNative: true,
    },
    // Sync between your computers through a folder a cloud service (OneDrive, Google Drive, Dropbox, iCloud) or
    // Syncthing keeps the same everywhere (main/sync). Off until you choose a folder. deviceName: how this
    // computer is listed on the others ('' = its computer name).
    sync: { enabled: false, folder: '', deviceName: '', bookmarks: true, history: true, tabs: true, settings: true },
    // New versions from Bifrost's releases on GitHub (main/updater.js): downloaded by themselves (auto), and put
    // in the next time Bifrost starts.
    updates: { auto: true },
    onboarding: { done: false },
    settingsVersion: 3,            // which one-time upgrades of saved settings have run (main/settings.js)
  };

  // Every command that can be bound to a key or run from the command palette (> prefix).
  // Performance profiles. Each sets how tabs sleep (and which), animations and visual effects, whether
  // background tabs are slowed down, how much history the launcher keeps in memory, and (after a restart)
  // how many renderer processes Chromium may use (0: as many as it likes).
  // Animation styles: time stretches every duration, amp scales how far things move and grow (and how
  // much they fade), spring gives entrances a little overshoot.
  const ANIM_STYLES = {
    subtle: { label: 'Subtle', desc: 'Quick fades, barely any movement.', time: 0.85, amp: 0.6, spring: false },
    smooth: { label: 'Smooth', desc: 'Clear, gliding motion.', time: 1.3, amp: 1.7, spring: false },
    playful: { label: 'Playful', desc: 'Bigger, bouncier motion.', time: 1.55, amp: 2.4, spring: true },
    snappy: { label: 'Snappy', desc: 'Short and crisp.', time: 0.7, amp: 1.1, spring: false },
  };
  const animStyle = (s) => ANIM_STYLES[(s && s.animations && s.animations.style) || 'smooth'] || ANIM_STYLES.smooth;
  const PERF_PRESETS = {
    max: {
      sleepEnabled: false, sleepMinutes: 240, sleepPinned: false, sleepAudible: false, sleepOtherSpaces: false,
      animations: true, lowVisuals: false, tabPreviews: true, backgroundThrottling: false,
      historyIndexSize: 50000, rendererLimit: 0,
    },
    balanced: {
      sleepEnabled: true, sleepMinutes: 30, sleepPinned: false, sleepAudible: false, sleepOtherSpaces: true,
      animations: true, lowVisuals: false, tabPreviews: true, backgroundThrottling: true,
      historyIndexSize: 10000, rendererLimit: 0,
    },
    saver: {
      sleepEnabled: true, sleepMinutes: 5, sleepPinned: true, sleepAudible: false, sleepOtherSpaces: true,
      animations: false, lowVisuals: true, tabPreviews: false, backgroundThrottling: true,
      historyIndexSize: 2000, rendererLimit: 4,
    },
  };
  // The performance knobs in effect for these settings.
  function perf(settings) {
    const p = (settings && settings.performance) || {};
    const base = PERF_PRESETS.balanced;
    if (p.profile === 'custom') return Object.assign({}, base, p.custom || {});
    return Object.assign({}, PERF_PRESETS[p.profile] || base);
  }

  // Modules for the start page.
  const NTP_MODULES = [
    { id: 'weather', label: 'Weather', icon: 'sun', desc: 'Now and the next few days, for a city you choose (from Open-Meteo, no account needed).' },
    { id: 'todo', label: 'To-do list', icon: 'check', desc: 'A checklist that stays until you clear it.' },
    { id: 'notes', label: 'Notes', icon: 'edit', desc: 'A scratchpad, saved as you type.' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar', desc: 'This month at a glance.' },
    { id: 'countdown', label: 'Countdown', icon: 'hourglass', desc: 'Days (and hours) until a date.' },
    { id: 'topsites', label: 'Most visited', icon: 'grid', desc: 'The sites you open most.' },
    { id: 'recent', label: 'Recently closed', icon: 'rotate', desc: 'Tabs you closed, to bring back.' },
    { id: 'folder', label: 'Bookmark folder', icon: 'folder', desc: 'A bookmark folder as a list.' },
    { id: 'stats', label: 'Bifrost stats', icon: 'cpu', desc: 'Memory in use, open pages and ads blocked.' },
    { id: 'tips', label: 'Tips', icon: 'bolt', desc: 'A keyboard shortcut or feature worth knowing.' },
  ];
  const NTP_PLACES = [
    ['above', 'Above the search box'], ['below', 'Under Speed Dial'], ['left', 'Left side'], ['right', 'Right side'],
    ['top-left', 'Top left corner'], ['top', 'Top'], ['top-right', 'Top right corner'],
    ['bottom-left', 'Bottom left corner'], ['bottom', 'Bottom'], ['bottom-right', 'Bottom right corner'],
  ];

  // Everything that can go on the toolbar or the sidebar. "only" limits an item to one area;
  // "multi" items may appear more than once; "cmd" items run that command when clicked.
  const LAYOUT_ITEMS = [
    { id: 'back', label: 'Back', icon: 'back' },
    { id: 'forward', label: 'Forward', icon: 'forward' },
    { id: 'reload', label: 'Reload', icon: 'reload' },
    { id: 'home', label: 'Home', icon: 'home', cmd: 'home' },
    { id: 'newtab', label: 'New tab', icon: 'plus' },
    { id: 'address', label: 'Address bar', icon: 'search', only: 'toolbar', required: true },
    { id: 'launcher', label: 'Launcher', icon: 'bolt', cmd: 'launcher' },
    { id: 'sidebar', label: 'Collapse sidebar', icon: 'sidebar', cmd: 'toggleSidebar' },
    { id: 'workspace', label: 'Current space', icon: 'layers', only: 'sidebar' },
    { id: 'spaces', label: 'All spaces', icon: 'grid', only: 'sidebar' },
    { id: 'split', label: 'Split view', icon: 'split' },
    { id: 'bookmarks', label: 'Bookmarks', icon: 'book', cmd: 'panelBookmarks', panel: true },
    { id: 'history', label: 'History', icon: 'clock', cmd: 'panelHistory', panel: true },
    { id: 'downloads', label: 'Downloads', icon: 'download' },
    { id: 'reader', label: 'Reader view', icon: 'reader', cmd: 'readerMode' },
    { id: 'translate', label: 'Translate page', icon: 'translate', cmd: 'translatePage' },
    { id: 'screenshot', label: 'Screenshot', icon: 'camera', cmd: 'screenshot' },
    { id: 'pip', label: 'Picture-in-picture', icon: 'pip', cmd: 'pictureInPicture' },
    { id: 'reopen', label: 'Reopen closed tab', icon: 'rotate', cmd: 'reopenTab' },
    { id: 'newWindow', label: 'New window', icon: 'window', cmd: 'newWindow' },
    { id: 'privateWindow', label: 'Private window', icon: 'mask', cmd: 'newPrivateWindow' },
    { id: 'zoomOut', label: 'Zoom out', icon: 'zoomOut', cmd: 'zoomOut' },
    { id: 'zoomIn', label: 'Zoom in', icon: 'zoomIn', cmd: 'zoomIn' },
    { id: 'print', label: 'Print', icon: 'print', cmd: 'print' },
    { id: 'devtools', label: 'Developer tools', icon: 'code', cmd: 'devtools' },
    { id: 'taskManager', label: 'Task manager', icon: 'cpu', cmd: 'taskManager' },
    { id: 'fullscreen', label: 'Full screen', icon: 'maximize', cmd: 'fullscreen' },
    { id: 'tabLayout', label: 'Switch tab layout', icon: 'layout', cmd: 'toggleTabLayout' },
    { id: 'theme', label: 'Next theme', icon: 'moon', cmd: 'cycleTheme' },
    { id: 'vim', label: 'Vim keys', icon: 'vim', cmd: 'toggleVim' },
    { id: 'adblock', label: 'Ad blocker', icon: 'shield' },
    { id: 'extensions', label: 'Extensions', icon: 'puzzle', only: 'toolbar' },
    { id: 'settings', label: 'Settings', icon: 'sliders', cmd: 'openSettings' },
    { id: 'menu', label: 'Menu', icon: 'menu', required: true },
    { id: 'spacer', label: 'Flexible space', icon: 'spacer', multi: true },
    { id: 'divider', label: 'Divider', icon: 'divider', multi: true },
  ];
  function layoutItem(id) { return LAYOUT_ITEMS.find((x) => x.id === id) || null; }

  const COMMANDS = [
    ['newTab', 'New tab', 'Tabs', ['Ctrl+T']],
    ['closeTab', 'Close tab', 'Tabs', ['Ctrl+W', 'Ctrl+F4']],
    ['reopenTab', 'Reopen closed tab', 'Tabs', ['Ctrl+Shift+T']],
    ['nextTab', 'Next tab', 'Tabs', ['Ctrl+Tab', 'Ctrl+PageDown']],
    ['prevTab', 'Previous tab', 'Tabs', ['Ctrl+Shift+Tab', 'Ctrl+PageUp']],
    ['tab1', 'Go to tab 1', 'Tabs', ['Ctrl+1']], ['tab2', 'Go to tab 2', 'Tabs', ['Ctrl+2']],
    ['tab3', 'Go to tab 3', 'Tabs', ['Ctrl+3']], ['tab4', 'Go to tab 4', 'Tabs', ['Ctrl+4']],
    ['tab5', 'Go to tab 5', 'Tabs', ['Ctrl+5']], ['tab6', 'Go to tab 6', 'Tabs', ['Ctrl+6']],
    ['tab7', 'Go to tab 7', 'Tabs', ['Ctrl+7']], ['tab8', 'Go to tab 8', 'Tabs', ['Ctrl+8']],
    ['lastTab', 'Go to last tab', 'Tabs', ['Ctrl+9']],
    ['duplicateTab', 'Duplicate tab', 'Tabs', []],
    ['pinTab', 'Pin or unpin tab', 'Tabs', []],
    ['muteTab', 'Mute or unmute tab', 'Tabs', ['Ctrl+M']],
    ['closeOtherTabs', 'Close other tabs', 'Tabs', []],
    ['sleepTab', 'Put tab to sleep', 'Tabs', []],
    ['moveTabLeft', 'Move tab up/left', 'Tabs', ['Ctrl+Shift+PageUp']],
    ['moveTabRight', 'Move tab down/right', 'Tabs', ['Ctrl+Shift+PageDown']],
    ['groupTab', 'Add tab to a new group', 'Groups', []],
    ['ungroupTab', 'Remove tab from its group', 'Groups', []],
    ['newWorkspace', 'New workspace', 'Workspaces', []],
    ['nextWorkspace', 'Next workspace', 'Workspaces', ['Ctrl+Alt+PageDown']],
    ['prevWorkspace', 'Previous workspace', 'Workspaces', ['Ctrl+Alt+PageUp']],
    ['workspace1', 'Switch to workspace 1', 'Workspaces', ['Alt+1']], ['workspace2', 'Switch to workspace 2', 'Workspaces', ['Alt+2']],
    ['workspace3', 'Switch to workspace 3', 'Workspaces', ['Alt+3']], ['workspace4', 'Switch to workspace 4', 'Workspaces', ['Alt+4']],
    ['workspace5', 'Switch to workspace 5', 'Workspaces', ['Alt+5']], ['workspace6', 'Switch to workspace 6', 'Workspaces', ['Alt+6']],
    ['workspace7', 'Switch to workspace 7', 'Workspaces', ['Alt+7']], ['workspace8', 'Switch to workspace 8', 'Workspaces', ['Alt+8']],
    ['workspace9', 'Switch to workspace 9', 'Workspaces', ['Alt+9']],
    ['splitWithNext', 'Split view with the next tab', 'Split view', ['Ctrl+Shift+Backslash']],
    ['splitPick', 'Split view with a tab you pick', 'Split view', ['Ctrl+Backslash']],
    ['unsplit', 'Close split view', 'Split view', []],
    ['splitRotate', 'Rotate split view', 'Split view', []],
    ['focusNextPane', 'Focus next split pane', 'Split view', ['Ctrl+Alt+Right']],
    ['focusPrevPane', 'Focus previous split pane', 'Split view', ['Ctrl+Alt+Left']],
    ['launcher', 'Open the launcher', 'Navigation', ['Ctrl+Space']],
    ['commandPalette', 'Open the command palette', 'Navigation', ['Ctrl+Shift+P']],
    ['focusAddress', 'Edit the address', 'Navigation', ['Ctrl+L', 'Alt+D', 'F6']],
    ['back', 'Back', 'Navigation', ['Alt+Left', 'BrowserBack']],
    ['forward', 'Forward', 'Navigation', ['Alt+Right', 'BrowserForward']],
    ['reload', 'Reload', 'Navigation', ['Ctrl+R', 'F5']],
    ['hardReload', 'Reload, ignoring cache', 'Navigation', ['Ctrl+Shift+R', 'Ctrl+F5']],
    ['stop', 'Stop loading', 'Navigation', []],
    ['home', 'Home', 'Navigation', ['Alt+Home']],
    ['find', 'Find in page', 'Page', ['Ctrl+F']],
    ['findNext', 'Find next', 'Page', ['F3', 'Ctrl+G']],
    ['findPrev', 'Find previous', 'Page', ['Shift+F3', 'Ctrl+Shift+G']],
    ['zoomIn', 'Zoom in', 'Page', ['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd']],
    ['zoomOut', 'Zoom out', 'Page', ['Ctrl+Minus', 'Ctrl+NumpadSubtract']],
    ['zoomReset', 'Reset zoom', 'Page', ['Ctrl+0', 'Ctrl+Numpad0']],
    ['bookmarkPage', 'Bookmark this page', 'Page', ['Ctrl+D']],
    ['readerMode', 'Reader view', 'Page', ['F9']],
    ['translatePage', 'Translate page (or show the original)', 'Page', []],
    ['screenshot', 'Take a screenshot', 'Page', ['Ctrl+Shift+S']],
    ['pictureInPicture', 'Picture-in-picture', 'Page', []],
    ['print', 'Print', 'Page', ['Ctrl+P']],
    ['savePage', 'Save page as', 'Page', ['Ctrl+S']],
    ['viewSource', 'View page source', 'Page', ['Ctrl+U']],
    ['devtools', 'Developer tools', 'Page', ['F12', 'Ctrl+Shift+I']],
    ['copyUrl', 'Copy page address', 'Page', []],
    ['toggleAdblockSite', 'Toggle ad blocking on this site', 'Page', []],
    ['toggleVimSite', 'Toggle Vim keys on this site', 'Page', []],
    ['newWindow', 'New window', 'Window', ['Ctrl+N']],
    ['newPrivateWindow', 'New private window', 'Window', ['Ctrl+Shift+N']],
    ['closeWindow', 'Close window', 'Window', ['Ctrl+Shift+W']],
    ['fullscreen', 'Full screen', 'Window', ['F11']],
    ['toggleSidebar', 'Show or hide the sidebar', 'Window', ['F4']],
    ['toggleTabLayout', 'Switch vertical and horizontal tabs', 'Window', []],   // (not Ctrl+Shift+V: that's paste as plain text)
    ['toggleBookmarksBar', 'Show or hide the bookmarks bar', 'Window', ['Ctrl+Shift+B']],
    ['toggleCompact', 'Compact toolbar (address bar as a title pill)', 'Window', ['Ctrl+Shift+F']],
    ['toggleBlend', 'Sidebar and toolbar: the window, the page’s color, or the page blurred', 'Window', []],
    ['toggleTopbarAutoHide', 'Auto-hide the top bar', 'Window', []],
    ['toggleSidebarAutoHide', 'Auto-hide the sidebar', 'Window', []],
    ['customizeLayout', 'Customize toolbar and sidebar', 'Window', []],
    ['sleepBackgroundTabs', 'Put background tabs to sleep', 'Tabs', []],
    ['panelBookmarks', 'Bookmarks panel', 'Panels', ['Ctrl+Shift+O']],
    ['panelHistory', 'History panel', 'Panels', ['Ctrl+H']],
    ['panelDownloads', 'Downloads panel', 'Panels', ['Ctrl+J']],
    ['openSettings', 'Settings', 'Pages', ['Ctrl+Comma']],
    ['openHistory', 'History page', 'Pages', []],
    ['openBookmarks', 'Bookmark manager', 'Pages', []],
    ['openDownloads', 'Downloads page', 'Pages', []],
    ['openExtensions', 'Extensions', 'Pages', []],
    ['taskManager', 'Task manager', 'Tools', ['Shift+Escape']],
    ['clearData', 'Clear browsing data', 'Tools', ['Ctrl+Shift+Delete']],
    ['importData', 'Import from another browser', 'Tools', []],
    ['toggleVim', 'Turn Vim keys on or off', 'Tools', []],
    ['toggleAnimations', 'Turn animations on or off', 'Tools', []],
    ['cycleTheme', 'Next theme', 'Tools', []],
  ].map(([id, title, category, keys]) => ({ id, title, category, keys }));

  // Vim actions inside pages (handled by the tab preload) with default key sequences.
  const VIM_KEYS = {
    scrollDown: 'j', scrollUp: 'k', scrollLeft: 'h', scrollRight: 'l',
    halfPageDown: 'd', halfPageUp: 'u', pageDown: '', pageUp: '',
    top: 'gg', bottom: 'G',
    hints: 'f', hintsNewTab: 'F', hintsCopy: 'yf', hintsSplit: 'gs',
    back: 'H', forward: 'L', reload: 'r',
    closeTab: 'x', reopenTab: 'X', nextTab: 'K', prevTab: 'J',
    firstTab: 'g0', lastTab: 'g$',
    launcher: 'o', launcherNewTab: 'O', tabSearch: 'T',
    find: '/', findNext: 'n', findPrev: 'N',
    copyUrl: 'yy', openClipboard: 'p', openClipboardNewTab: 'P',
    focusInput: 'gi', upUrl: 'gu', rootUrl: 'gU',
    insertMode: 'i', passNext: 'Ctrl+v', help: '?',
  };

  // ------------------------------------------------------------ accelerators
  // Format: modifiers (Ctrl, Alt, Shift, Meta) + one key, joined with "+".
  // Keys: letters (T), digits (1), F1-F24, and KeyboardEvent.code names (Space, Tab, PageDown, Left, Equal…).
  const CODE_ALIASES = {
    Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Esc: 'Escape', Plus: 'Equal',
    Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backslash: 'Backslash', Minus: 'Minus', Equal: 'Equal',
    Delete: 'Delete', Del: 'Delete', Return: 'Enter', Backquote: 'Backquote', Semicolon: 'Semicolon', Quote: 'Quote',
    BracketLeft: 'BracketLeft', BracketRight: 'BracketRight',
  };

  function parseAccelerator(acc) {
    const parts = String(acc || '').split('+').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    const out = { ctrl: false, alt: false, shift: false, meta: false, code: '' };
    const key = parts.pop();
    for (const p of parts) {
      const low = p.toLowerCase();
      if (low === 'ctrl' || low === 'control' || low === 'cmdorctrl') out.ctrl = true;
      else if (low === 'alt' || low === 'option') out.alt = true;
      else if (low === 'shift') out.shift = true;
      else if (low === 'meta' || low === 'cmd' || low === 'super' || low === 'win') out.meta = true;
      else return null;
    }
    out.code = keyToCode(key);
    return out.code ? out : null;
  }

  function keyToCode(k) {
    if (/^[a-z]$/i.test(k)) return 'Key' + k.toUpperCase();
    if (/^[0-9]$/.test(k)) return 'Digit' + k;
    if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(k)) return k.toUpperCase();
    if (CODE_ALIASES[k]) return CODE_ALIASES[k];
    return k; // already a KeyboardEvent.code (PageDown, Tab, Space, NumpadAdd, BrowserBack…)
  }

  // Normalizes a KeyboardEvent or Electron Input ({type,key,code,control,alt,shift,meta}) to a comparable object.
  function eventToChord(e) {
    return {
      ctrl: !!(e.ctrlKey ?? e.control),
      alt: !!(e.altKey ?? e.alt),
      shift: !!(e.shiftKey ?? e.shift),
      meta: !!(e.metaKey ?? e.meta),
      code: e.code || '',
    };
  }

  function chordMatches(a, chord) {
    return a && a.code === chord.code && a.ctrl === chord.ctrl && a.alt === chord.alt && a.shift === chord.shift && a.meta === chord.meta;
  }

  function chordToString(c) {
    const names = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Escape: 'Esc', NumpadAdd: 'Num+', NumpadSubtract: 'Num-', Numpad0: 'Num0' };
    let k = c.code.replace(/^Key/, '').replace(/^Digit/, '');
    k = names[c.code] || k;
    return [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', c.meta && 'Win', k].filter(Boolean).join('+');
  }

  function chordFromEventString(e) { return chordToString(eventToChord(e)); }

  // Resolved command -> accelerator list, applying user overrides.
  function shortcutMap(settings) {
    const over = (settings && settings.keyboard && settings.keyboard.shortcuts) || {};
    const map = {};
    for (const c of COMMANDS) map[c.id] = Array.isArray(over[c.id]) ? over[c.id] : c.keys;
    return map;
  }

  // Compiled list for fast matching: [{ id, chord }]
  function compileShortcuts(settings) {
    const map = shortcutMap(settings);
    const out = [];
    for (const [id, accs] of Object.entries(map)) for (const acc of accs || []) {
      const chord = parseAccelerator(acc);
      if (chord) out.push({ id, chord, acc });
    }
    return out;
  }

  function findCommand(compiled, e) {
    const chord = eventToChord(e);
    for (const c of compiled) if (chordMatches(c.chord, chord)) return c.id;
    return null;
  }

  // ------------------------------------------------------------ merging
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // Deep-merges stored values onto defaults: unknown keys dropped, wrong types replaced by defaults.
  // Objects listed in OPEN_KEYS keep arbitrary keys (maps the user fills in).
  const OPEN_KEYS = new Set(['keyboard.shortcuts', 'keyboard.vim.keys', 'appearance.customTheme']);
  function deepMerge(def, val, pathKey = '') {
    if (OPEN_KEYS.has(pathKey)) return val && typeof val === 'object' && !Array.isArray(val) ? clone(val) : clone(def);
    if (Array.isArray(def)) return Array.isArray(val) ? clone(val) : clone(def);
    if (def === null) return val === undefined ? null : clone(val);
    if (def && typeof def === 'object') {
      const out = {};
      const src = val && typeof val === 'object' && !Array.isArray(val) ? val : {};
      for (const k of Object.keys(def)) out[k] = deepMerge(def[k], src[k], pathKey ? pathKey + '.' + k : k);
      return out;
    }
    if (val === undefined || val === null || typeof val !== typeof def) return def;
    if (typeof def === 'number' && !Number.isFinite(val)) return def;
    return val;
  }

  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, v) {
    const ks = path.split('.');
    const last = ks.pop();
    let o = obj;
    for (const k of ks) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    o[last] = v;
  }

  return {
    DEFAULTS, COMMANDS, VIM_KEYS, VIM_EXCLUDED, DEFAULT_ENGINES, LAYOUT_ITEMS, layoutItem, PERF_PRESETS, perf, ANIM_STYLES, animStyle, NTP_MODULES, NTP_PLACES,
    clone, deepMerge, getPath, setPath,
    parseAccelerator, eventToChord, chordMatches, chordToString, chordFromEventString, shortcutMap, compileShortcuts, findCommand, keyToCode,
  };
});
