// ==UserScript==
// @name         Lumen Dark Mode
// @namespace    https://lumen.ncsa.illinois.edu/
// @version      1.3.0
// @description  Persistent, flash-free dark mode for Lumen (lumen.ncsa.illinois.edu and lumen.computes.illinois.edu). Covers Bootstrap 5, the Illinois Toolkit web components (incl. shadow DOM) and Lumen's chat UI.
// @author       ekimtco2
// @match        https://lumen.ncsa.illinois.edu/*
// @match        http://lumen.ncsa.illinois.edu/*
// @match        https://lumen.computes.illinois.edu/*
// @match        http://lumen.computes.illinois.edu/*
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==

/*
 * How it stays dark with no flash, page to page:
 *   1. @run-at document-start  → CSS is injected before first paint.
 *   2. The <html> element gets .lumen-dark + data-bs-theme="dark" immediately,
 *      so the canvas is dark from the very first frame.
 *   3. attachShadow() is wrapped, so every ilw-* web component (header, footer,
 *      content, menus…) receives its dark stylesheet the instant its shadow
 *      root is created — before it ever renders light.
 *   4. A MutationObserver + a light polling fallback catch anything added later
 *      (chat messages, modals, late component upgrades).
 *
 * Theme = the "Theme: Auto / Dark / Light" link left of "Help | Log Out"; each
 * click moves to the next. Auto (the default) follows the system setting live.
 * The choice is kept in localStorage ("lumen-dark": "1" dark, "0" light, absent
 * auto) so it is read synchronously at document-start and never flashes.
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Palette — tweak here to re-theme the whole site
   * ------------------------------------------------------------------ */
  const P = {
    page:      '#14181f', // page background
    surface:   '#1a2029', // cards, tables, panels
    surface2:  '#1e2430', // inputs, modals, menus
    hover:     '#202734', // hover / stripe
    header:    '#161b24', // site header + nav bar
    footer:    '#10151d', // site footer
    border:    '#343b49', // strong border
    borderLt:  '#2a3140', // subtle border
    text:      '#d3d9e3', // body text
    textBright:'#e8eaee', // emphasized text
    muted:     '#8b93a2', // secondary text
    blue:      '#a9c4f0', // "Illinois blue" → light blue for dark bg
    link:      '#7aa7e8',
    linkHover: '#ffab73',
    orange:    '#ff5f05', // Illinois orange (kept as-is)
    focusBg:   '#24304a',
    focusTx:   '#cfe0fb',
    thead:     '#0f1521', // table header background
  };

  /* ------------------------------------------------------------------ *
   * Document-level CSS (light DOM: Bootstrap, Lumen app.css, slots)
   * ------------------------------------------------------------------ */
  const ROOT_CSS = `
/* ================= base ================= */
html.lumen-dark {
  color-scheme: dark;
  background: ${P.page};
}
html.lumen-dark body {
  background-color: ${P.page} !important;
  color: ${P.text};
}

/* ================= Illinois brand palette =================
   Custom properties inherit straight through shadow DOM. */
html.lumen-dark {
  --il-blue: ${P.blue} !important;
  --il-industrial: ${P.link} !important;
  --il-altgeld: ${P.linkHover} !important;
  --il-orange: ${P.orange} !important;
  --il-storm-10: ${P.textBright} !important;
  --il-storm-30: #b9bdc4 !important;
  --il-storm-60: ${P.border} !important;
  --il-storm-70: #6b6f78 !important;
  --il-storm-80: #8a8e96 !important;
  --il-storm-95: #1c212b !important;
}

/* ================= Illinois Toolkit (ilw-*) component vars ================= */
html.lumen-dark {
  /* page / global */
  --ilw-background--color: ${P.page} !important;
  --ilw-text--color: ${P.text} !important;
  --ilw-heading--color: ${P.blue} !important;
  --ilw-link--color: ${P.link} !important;
  --ilw-link--visited-color: #8fb4ef !important;
  --ilw-link--focused-color: ${P.linkHover} !important;
  --ilw-link--focus-background-color: ${P.focusBg} !important;
  --ilw-link--focus-color: ${P.focusTx} !important;
  --ilw-panel--color: ${P.surface} !important;
  --ilw-panel--highlighted-color: ${P.hover} !important;
  --ilw-panel--focused-color: ${P.focusBg} !important;

  /* content */
  --ilw-content--background-color: ${P.page} !important;

  /* header */
  --ilw-header--background: ${P.header} !important;
  --ilw-header--text: ${P.blue} !important;
  --ilw-header--link-hover: ${P.linkHover} !important;
  --ilw-header--accent: ${P.orange} !important;

  /* header nav menu */
  --ilw-header-menu--background: ${P.header} !important;
  --ilw-header-menu--link-color: ${P.text} !important;
  --ilw-header-menu--link-color--hover: ${P.linkHover} !important;
  --ilw-header-menu--link-color--focus: ${P.focusTx} !important;
  --ilw-header-menu--link-background: transparent !important;
  --ilw-header-menu--link-background--hover: ${P.hover} !important;
  --ilw-header-menu--link-background--focus: ${P.focusBg} !important;

  /* colour system — "white" theme sources (the theme Lumen uses) */
  --ilw-color--white--background: ${P.page} !important;
  --ilw-color--white--text: ${P.text} !important;
  --ilw-color--white--border: ${P.border} !important;
  --ilw-color--white--border-light: ${P.borderLt} !important;
  --ilw-color--white--link: ${P.link} !important;
  --ilw-color--white--link-hover: ${P.linkHover} !important;
  --ilw-color--white--link-visited: #8fb4ef !important;
  --ilw-color--white--heading: ${P.blue} !important;
  --ilw-color--white--heading-link: ${P.link} !important;
  --ilw-color--white--heading-link-hover: ${P.linkHover} !important;
  --ilw-color--white--heading-link-visited: #8fb4ef !important;
  --ilw-color--white--control: ${P.surface2} !important;
  --ilw-color--white--control-text: ${P.blue} !important;
  --ilw-color--white--control-accent: ${P.orange} !important;
  --ilw-color--white--control-accent-text: #fff !important;
  --ilw-color--white--table-border: ${P.border} !important;
  --ilw-color--white--table-background: ${P.surface} !important;
  --ilw-color--white--table-row-stripe: ${P.hover} !important;
  --ilw-color--white--table-head-background: ${P.thead} !important;
  --ilw-color--white--table-head-color: ${P.text} !important;

  /* colour system — derived */
  --ilw-color--background: ${P.page} !important;
  --ilw-color--text: ${P.text} !important;
  --ilw-color--border: ${P.border} !important;
  --ilw-color--border-light: ${P.borderLt} !important;
  --ilw-color--link: ${P.link} !important;
  --ilw-color--link-hover: ${P.linkHover} !important;
  --ilw-color--link-visited: #8fb4ef !important;
  --ilw-color--heading: ${P.blue} !important;
  --ilw-color--heading-link: ${P.link} !important;
  --ilw-color--heading-link-hover: ${P.linkHover} !important;
  --ilw-color--heading-link-visited: #8fb4ef !important;
  --ilw-color--control: ${P.surface2} !important;
  --ilw-color--control-text: ${P.blue} !important;
  --ilw-color--control-accent: ${P.orange} !important;
  --ilw-color--control-accent-text: #fff !important;
  --ilw-color--focus--background: ${P.focusBg} !important;
  --ilw-color--focus--text: ${P.focusTx} !important;
  --ilw-color--focus--outline: ${P.link} !important;
  --ilw-color--table-border: ${P.border} !important;
  --ilw-color--table-background: ${P.surface} !important;
  --ilw-color--table-row-stripe: ${P.hover} !important;
  --ilw-color--table-head-background: ${P.thead} !important;
  --ilw-color--table-head-color: ${P.text} !important;
}

/* ================= Bootstrap 5 root vars ================= */
html.lumen-dark {
  --bs-body-bg: ${P.page} !important;
  --bs-body-bg-rgb: 20, 24, 31 !important;
  --bs-body-color: ${P.text} !important;
  --bs-body-color-rgb: 211, 217, 227 !important;
  --bs-emphasis-color: ${P.textBright} !important;
  --bs-emphasis-color-rgb: 232, 234, 238 !important;
  --bs-secondary-color: rgba(211, 217, 227, 0.65) !important;
  --bs-secondary-color-rgb: 211, 217, 227 !important;
  --bs-tertiary-color: rgba(211, 217, 227, 0.45) !important;
  --bs-secondary-bg: #232a36 !important;
  --bs-secondary-bg-rgb: 35, 42, 54 !important;
  --bs-tertiary-bg: ${P.surface} !important;
  --bs-tertiary-bg-rgb: 26, 32, 41 !important;
  --bs-border-color: ${P.border} !important;
  --bs-border-color-rgb: 52, 59, 73 !important;
  --bs-heading-color: ${P.textBright} !important;
  --bs-link-color: ${P.link} !important;
  --bs-link-color-rgb: 122, 167, 232 !important;
  --bs-link-hover-color: ${P.linkHover} !important;
  --bs-link-hover-color-rgb: 255, 171, 115 !important;
  --bs-light: ${P.surface} !important;
  --bs-light-rgb: 26, 32, 41 !important;
  --bs-form-check-bg: ${P.surface2} !important;
  --bs-code-color: #f5a97f !important;
}

/* ================= Bootstrap components ================= */
html.lumen-dark .card {
  background-color: ${P.surface} !important;
  border-color: ${P.borderLt} !important;
  color: ${P.text} !important;
}
html.lumen-dark .card-header,
html.lumen-dark .card-footer { border-color: ${P.borderLt} !important; }

html.lumen-dark .modal-content {
  background-color: ${P.surface2} !important;
  border-color: ${P.borderLt} !important;
  color: ${P.text} !important;
}
html.lumen-dark .modal-header,
html.lumen-dark .modal-footer { border-color: ${P.borderLt} !important; }
html.lumen-dark .modal-title { color: ${P.textBright} !important; }

html.lumen-dark .form-control,
html.lumen-dark .form-select {
  background-color: ${P.surface2} !important;
  border-color: ${P.border} !important;
  color: ${P.textBright} !important;
}
html.lumen-dark .form-control::placeholder { color: #7d8595 !important; }
html.lumen-dark .form-control:focus,
html.lumen-dark .form-select:focus {
  background-color: ${P.surface2} !important;
  border-color: #5b8dd9 !important;
  color: ${P.textBright} !important;
  box-shadow: 0 0 0 0.25rem rgba(91, 141, 217, 0.25) !important;
}
html.lumen-dark .form-control[readonly] { background-color: ${P.hover} !important; }
html.lumen-dark .input-group-text {
  background-color: ${P.hover} !important;
  border-color: ${P.border} !important;
  color: ${P.text} !important;
}

html.lumen-dark .form-check-input { border-color: #4a5262 !important; }
html.lumen-dark .form-check-label { color: ${P.text} !important; }

html.lumen-dark .list-group-item {
  background-color: ${P.surface} !important;
  border-color: ${P.borderLt} !important;
  color: ${P.text} !important;
}
html.lumen-dark .list-group-item:hover {
  background-color: ${P.hover} !important;
  color: ${P.textBright} !important;
}
html.lumen-dark .list-group-item.active {
  background-color: #2c4a7c !important;
  border-color: #2c4a7c !important;
}

html.lumen-dark .dropdown-menu {
  --bs-dropdown-bg: ${P.surface2};
  --bs-dropdown-border-color: ${P.border};
  --bs-dropdown-link-color: ${P.text};
  --bs-dropdown-link-hover-color: ${P.textBright};
  --bs-dropdown-link-hover-bg: ${P.hover};
  --bs-dropdown-divider-bg: ${P.borderLt};
}

html.lumen-dark .popover {
  --bs-popover-bg: ${P.surface2};
  --bs-popover-border-color: ${P.border};
  --bs-popover-header-bg: ${P.hover};
  --bs-popover-header-color: ${P.textBright};
  --bs-popover-body-color: ${P.text};
}
html.lumen-dark .popover-warning .popover-header {
  background-color: #3a2f10 !important;
  border-bottom-color: #6b5a1e !important;
  color: #e8d48b !important;
}
html.lumen-dark .popover-warning .popover-body { color: ${P.text} !important; }

/* tabs */
html.lumen-dark .nav-tabs {
  --bs-nav-tabs-border-color: ${P.borderLt};
  --bs-nav-link-color: ${P.muted};
  --bs-nav-link-hover-color: ${P.textBright};
  --bs-nav-link-disabled-color: #5a6272;
  --bs-nav-tabs-link-hover-border-color: transparent transparent ${P.borderLt};
  --bs-nav-tabs-link-active-color: ${P.textBright};
  --bs-nav-tabs-link-active-bg: ${P.surface};
  --bs-nav-tabs-link-active-border-color: ${P.borderLt} ${P.borderLt} ${P.surface};
}

/* tables */
html.lumen-dark .table {
  --bs-table-color: ${P.text};
  --bs-table-bg: transparent;
  --bs-table-border-color: ${P.border};
  --bs-table-striped-bg: rgba(255, 255, 255, 0.03);
  --bs-table-striped-color: ${P.textBright};
  --bs-table-hover-bg: rgba(255, 255, 255, 0.055);
  --bs-table-hover-color: #fff;
  color: ${P.text};
}
html.lumen-dark .table-light {
  --bs-table-bg: ${P.thead};
  --bs-table-color: ${P.text};
  --bs-table-border-color: ${P.border};
  color: ${P.text};
}

/* misc */
html.lumen-dark .progress { background-color: #232a36 !important; }
html.lumen-dark .progress-bar { background-color: #3a5a8c !important; }
html.lumen-dark .text-muted,
html.lumen-dark .form-text { color: ${P.muted} !important; }
html.lumen-dark pre {
  background-color: ${P.footer};
  color: ${P.text};
  border: 1px solid ${P.borderLt};
  border-radius: 0.375rem;
}

/* buttons (site CSS force-paints these with !important, so match it) */
html.lumen-dark .btn.btn-primary {
  background-color: #24466e !important;
  border-color: #24466e !important;
  color: #fff !important;
}
html.lumen-dark .btn.btn-primary:hover,
html.lumen-dark .btn.btn-primary:focus,
html.lumen-dark .btn.btn-primary:active {
  background-color: #2c5585 !important;
  border-color: #2c5585 !important;
  color: #fff !important;
}
html.lumen-dark .btn.btn-outline-primary {
  background: transparent !important;
  color: ${P.blue} !important;
  border-color: #4a6a9e !important;
}
html.lumen-dark .btn.btn-outline-primary:hover,
html.lumen-dark .btn.btn-outline-primary:focus,
html.lumen-dark .btn.btn-outline-primary:active {
  background-color: #2c4a7c !important;
  border-color: #4a6a9e !important;
  color: #eaf1fc !important;
}
html.lumen-dark .btn.btn-outline-secondary {
  color: #9aa4b2 !important;
  border-color: #4a5262 !important;
}
html.lumen-dark .btn.btn-outline-secondary:hover,
html.lumen-dark .btn.btn-outline-secondary:focus {
  background-color: #2a3140 !important;
  color: ${P.textBright} !important;
  border-color: #5a6375 !important;
}
html.lumen-dark .btn.btn-secondary {
  background-color: #3a4250 !important;
  border-color: #3a4250 !important;
  color: ${P.textBright} !important;
}
html.lumen-dark .btn.btn-secondary:hover {
  background-color: #475061 !important;
  border-color: #475061 !important;
}
html.lumen-dark .btn.btn-logout {
  color: ${P.blue} !important;
  border-color: #4a6a9e !important;
}
html.lumen-dark .btn.btn-logout:hover,
html.lumen-dark .btn.btn-logout:focus {
  background-color: #2c4a7c !important;
  color: #fff !important;
}

/* ================= Lumen app.css overrides ================= */
html.lumen-dark ilw-header {
  background: ${P.header} !important;
  border-bottom-color: ${P.borderLt} !important;
}

html.lumen-dark .chat-messages { background: ${P.page} !important; }
html.lumen-dark .conv-item { border-bottom-color: #262c38 !important; }
html.lumen-dark .conv-item:hover { background: #1c222d !important; }
html.lumen-dark .conv-item.active {
  background: #1e2a44 !important;
  border-left-color: #5b8dd9 !important;
}
html.lumen-dark .conv-remove-btn { color: #98a2b3 !important; }
html.lumen-dark .chat-sidebar.offcanvas { border-right-color: ${P.borderLt} !important; }
html.lumen-dark .msg-meta { color: ${P.muted} !important; }
html.lumen-dark .quick-chat-notice {
  background: ${P.surface} !important;
  border-color: ${P.borderLt} ${P.borderLt} ${P.borderLt} #5b8dd9 !important;
  color: #c4ccd8 !important;
}
html.lumen-dark .attach-btn {
  border-color: ${P.border} !important;
  color: #98a2b3 !important;
}
html.lumen-dark .attach-btn:hover,
html.lumen-dark .attach-btn:focus {
  background-color: #1c222d !important;
  color: ${P.blue} !important;
  border-color: #5b8dd9 !important;
}
html.lumen-dark .chat-input-bar.drag-over #chat-input { border-color: #5b8dd9 !important; }
html.lumen-dark .navbar-lumen { background-color: ${P.header} !important; }
html.lumen-dark .navbar-lumen .navbar-brand,
html.lumen-dark .navbar-lumen .nav-link { color: ${P.blue} !important; }
html.lumen-dark .navbar-lumen .nav-link:hover { color: ${P.focusTx} !important; }
html.lumen-dark .sort-asc .sa-up,
html.lumen-dark .sort-desc .sa-dn { color: ${P.textBright} !important; }
html.lumen-dark .profile-stat-card { background: ${P.surface} !important; }
html.lumen-dark .profile-avatar-img { border-color: ${P.border} !important; }
html.lumen-dark .profile-col-meta { border-left-color: ${P.borderLt} !important; }

/* announcement banner (has inline light styles on the element) */
html.lumen-dark .announcement-banner {
  background-color: #2b2413 !important;
  color: #e8d48b !important;
  border-color: #6b5a1e !important;
}
html.lumen-dark .announcement-banner a { color: #ffc95e !important; }

/* chat bubbles keep their navy/orange identity; just re-assert inner blocks */
html.lumen-dark .chat-bubble-assistant pre {
  background: rgba(0, 0, 0, 0.25) !important;
  border: none;
}
`;

  /* ------------------------------------------------------------------ *
   * Shadow-DOM CSS (injected into every ilw-* shadow root)
   * Note: :host !important beats the components' own :host defaults.
   * ------------------------------------------------------------------ */
  const SHADOW_CSS = `
:host {
  color-scheme: dark !important;

  /* brand palette */
  --il-blue: ${P.blue} !important;
  --il-industrial: ${P.link} !important;
  --il-altgeld: ${P.linkHover} !important;
  --il-orange: ${P.orange} !important;
  --il-storm-10: ${P.textBright} !important;
  --il-storm-30: #b9bdc4 !important;
  --il-storm-60: ${P.border} !important;
  --il-storm-70: #6b6f78 !important;
  --il-storm-80: #8a8e96 !important;
  --il-storm-95: #1c212b !important;

  /* global */
  --ilw-background--color: ${P.page} !important;
  --ilw-text--color: ${P.text} !important;
  --ilw-heading--color: ${P.blue} !important;
  --ilw-link--color: ${P.link} !important;
  --ilw-link--visited-color: #8fb4ef !important;
  --ilw-link--focused-color: ${P.linkHover} !important;
  --ilw-link--focus-background-color: ${P.focusBg} !important;
  --ilw-link--focus-color: ${P.focusTx} !important;
  --ilw-panel--color: ${P.surface} !important;
  --ilw-panel--highlighted-color: ${P.hover} !important;
  --ilw-panel--focused-color: ${P.focusBg} !important;

  /* content */
  --ilw-content--background-color: ${P.page} !important;

  /* header */
  --ilw-header--background: ${P.header} !important;
  --ilw-header--text: ${P.blue} !important;
  --ilw-header--link-hover: ${P.linkHover} !important;
  --ilw-header--accent: ${P.orange} !important;

  /* header nav menu */
  --ilw-header-menu--background: ${P.header} !important;
  --ilw-header-menu--link-color: ${P.text} !important;
  --ilw-header-menu--link-color--hover: ${P.linkHover} !important;
  --ilw-header-menu--link-color--focus: ${P.focusTx} !important;
  --ilw-header-menu--link-background: transparent !important;
  --ilw-header-menu--link-background--hover: ${P.hover} !important;
  --ilw-header-menu--link-background--focus: ${P.focusBg} !important;

  /* colour system — "white" theme sources */
  --ilw-color--white--background: ${P.page} !important;
  --ilw-color--white--text: ${P.text} !important;
  --ilw-color--white--border: ${P.border} !important;
  --ilw-color--white--border-light: ${P.borderLt} !important;
  --ilw-color--white--link: ${P.link} !important;
  --ilw-color--white--link-hover: ${P.linkHover} !important;
  --ilw-color--white--link-visited: #8fb4ef !important;
  --ilw-color--white--heading: ${P.blue} !important;
  --ilw-color--white--heading-link: ${P.link} !important;
  --ilw-color--white--heading-link-hover: ${P.linkHover} !important;
  --ilw-color--white--heading-link-visited: #8fb4ef !important;
  --ilw-color--white--control: ${P.surface2} !important;
  --ilw-color--white--control-text: ${P.blue} !important;
  --ilw-color--white--control-accent: ${P.orange} !important;
  --ilw-color--white--control-accent-text: #fff !important;
  --ilw-color--white--table-border: ${P.border} !important;
  --ilw-color--white--table-background: ${P.surface} !important;
  --ilw-color--white--table-row-stripe: ${P.hover} !important;
  --ilw-color--white--table-head-background: ${P.thead} !important;
  --ilw-color--white--table-head-color: ${P.text} !important;

  /* colour system — derived (background left to inline/theme values) */
  --ilw-color--text: ${P.text} !important;
  --ilw-color--border: ${P.border} !important;
  --ilw-color--border-light: ${P.borderLt} !important;
  --ilw-color--link: ${P.link} !important;
  --ilw-color--link-hover: ${P.linkHover} !important;
  --ilw-color--link-visited: #8fb4ef !important;
  --ilw-color--heading: ${P.blue} !important;
  --ilw-color--heading-link: ${P.link} !important;
  --ilw-color--heading-link-hover: ${P.linkHover} !important;
  --ilw-color--heading-link-visited: #8fb4ef !important;
  --ilw-color--control: ${P.surface2} !important;
  --ilw-color--control-text: ${P.blue} !important;
  --ilw-color--control-accent: ${P.orange} !important;
  --ilw-color--control-accent-text: #fff !important;
  --ilw-color--focus--background: ${P.focusBg} !important;
  --ilw-color--focus--text: ${P.focusTx} !important;
  --ilw-color--focus--outline: ${P.link} !important;
  --ilw-color--table-border: ${P.border} !important;
  --ilw-color--table-background: ${P.surface} !important;
  --ilw-color--table-row-stripe: ${P.hover} !important;
  --ilw-color--table-head-background: ${P.thead} !important;
  --ilw-color--table-head-color: ${P.text} !important;
}

/* structural fallbacks (in case internals hardcode light backgrounds) */
.page, .main, .content, .content-inner, .content-padding {
  background-color: transparent !important;
}

/* header chrome */
.header { border-bottom-color: ${P.borderLt} !important; }

/* university logos: navy → light blue, orange fill kept */
.block-i .outline,
.wordmark path,
.illinois path { fill: ${P.blue} !important; }
.block-i .fill { fill: ${P.orange} !important; }

/* footer */
.footer {
  background-color: ${P.footer} !important;
  color: #c9d1de !important;
}
.footer h1, .footer h2, .footer h3, .footer h4 { color: ${P.blue} !important; }
.footer a { color: #8fb4ef !important; }
`;

  /* ------------------------------------------------------------------ *
   * Engine
   * ------------------------------------------------------------------ */
  const STYLE_ID = 'lumen-dark-root-style';
  const STORE_KEY = 'lumen-dark';
  const styledRoots = new WeakSet();
  const injected = new Set(); // every <style> we add, so the toggle can switch them all
  // SkipTo.js (<skip-to-content>) adopts the first <style> in its shadow root as
  // its own and skips creating one, so a style of ours there unstyles the widget.
  const SHADOW_HOSTS =
    'ilw-page, ilw-header, ilw-header-menu, ilw-header-menu-section, ' +
    'ilw-header-megamenu, ilw-header-megamenu-section, ilw-footer, ' +
    'ilw-content, ilw-grid, ilw-spacer, ilw-page-title';
  const SKIP_HOSTS = new Set(['skip-to-content']);

  const docEl = document.documentElement;
  const origTheme = docEl.getAttribute('data-bs-theme');
  const MODES = ['auto', 'dark', 'light']; // the link cycles in this order
  const MODE_LABEL = { auto: 'Auto', dark: 'Dark', light: 'Light' };
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  let mode = 'auto';
  try {
    const v = localStorage.getItem(STORE_KEY);
    mode = v === '1' ? 'dark' : v === '0' ? 'light' : 'auto';
  } catch (e) { /* storage blocked: stay on auto */ }
  const isDark = () => mode === 'dark' || (mode === 'auto' && systemDark.matches);
  let enabled = isDark();
  let toggleLink = null;

  // Only writes when the value differs: classList.add / setAttribute queue a
  // mutation record even for an unchanged value, which re-triggers the observer below.
  function syncFlags() {
    docEl.classList.toggle('lumen-dark', enabled);
    const want = enabled ? 'dark' : origTheme;
    if (docEl.getAttribute('data-bs-theme') === want) return;
    if (want === null) docEl.removeAttribute('data-bs-theme');
    else docEl.setAttribute('data-bs-theme', want);
  }

  function track(s) {
    s.media = enabled ? 'all' : 'not all';
    injected.add(s);
    return s;
  }

  function installRootStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = ROOT_CSS;
    (document.head || docEl).appendChild(track(s));
  }

  function styleShadow(root) {
    if (!root || styledRoots.has(root) || SKIP_HOSTS.has(root.host.localName)) return;
    try {
      const s = document.createElement('style');
      s.textContent = SHADOW_CSS;
      root.appendChild(track(s));
      styledRoots.add(root);
    } catch (e) { /* ignore */ }
  }

  const nextMode = () => MODES[(MODES.indexOf(mode) + 1) % MODES.length];

  function labelToggle() {
    if (!toggleLink) return;
    const now = mode === 'auto' ? `Following the system theme (${enabled ? 'dark' : 'light'})` : `${MODE_LABEL[mode]} theme`;
    toggleLink.textContent = 'Theme: ' + MODE_LABEL[mode];
    toggleLink.title = `${now}. Click for ${MODE_LABEL[nextMode()]}.`;
  }

  function applyTheme() {
    enabled = isDark();
    syncFlags();
    for (const s of injected) {
      if (s.isConnected) s.media = enabled ? 'all' : 'not all';
      else injected.delete(s);
    }
    labelToggle();
  }

  function setMode(m) {
    mode = m;
    try {
      if (m === 'auto') localStorage.removeItem(STORE_KEY);
      else localStorage.setItem(STORE_KEY, m === 'dark' ? '1' : '0');
    } catch (e) { /* ignore */ }
    applyTheme();
  }

  systemDark.addEventListener('change', () => { if (mode === 'auto') applyTheme(); });

  // A link in the header's utility list, so the Toolkit styles it (and its
  // separator) exactly like "Help" and "Log Out".
  function addToggle() {
    const list = document.querySelector('ilw-header nav[slot="links"] ul');
    if (!list || toggleLink) return;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    a.setAttribute('role', 'button');
    a.className = 'lumen-dark-toggle';
    a.addEventListener('click', (e) => { e.preventDefault(); setMode(nextMode()); });
    a.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); setMode(nextMode()); } });
    li.appendChild(a);
    list.insertBefore(li, list.firstElementChild);
    toggleLink = a;
    labelToggle();
  }

  function scanShadows(scope) {
    let nodes;
    try {
      nodes = (scope || document).querySelectorAll(SHADOW_HOSTS);
    } catch (e) { return; }
    nodes.forEach((el) => { if (el.shadowRoot) styleShadow(el.shadowRoot); });
  }

  /* 1 — dark from the very first frame */
  syncFlags();
  installRootStyle();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggle);
  else addToggle();

  /* 2 — style every shadow root the instant it is created */
  try {
    const origAttach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const root = origAttach.call(this, init);
      styleShadow(root);
      return root;
    };
  } catch (e) { /* ignore */ }

  /* 3 — fallbacks: initial scan, light polling, mutation observer */
  scanShadows();
  setInterval(() => { installRootStyle(); scanShadows(); }, 400);

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.shadowRoot) styleShadow(n.shadowRoot);
        else if (n.querySelectorAll) scanShadows(n);
      }
    }
  });
  mo.observe(docEl, { childList: true, subtree: true });

  /* 4 — if anything strips our flags, put them right back */
  new MutationObserver(syncFlags).observe(docEl, {
    attributes: true,
    attributeFilter: ['class', 'data-bs-theme'],
  });
})();

