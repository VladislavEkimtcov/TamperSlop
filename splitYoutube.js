// ==UserScript==
// @name         YouTube Resizable Watch Columns
// @namespace    split-youtube
// @version      1.0.0
// @description  Drag the video/sidebar and thumbnail/title dividers on YouTube watch pages.
// @match        https://www.youtube.com/watch*
// @match        https://www.youtube.com/live/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'yt-resizable-watch-columns:v1';
  const DEFAULTS = { sidebar: 426, thumbnailRatio: 0.625 };
  const LIMITS = { sidebarMin: 320, titleMin: 150, primaryMin: 480, thumbnailMin: 140, columnGap: 24 };
  let settings = loadSettings();
  let activeDrag = null;
  let resizeObserver = null;
  let theaterRefreshTimer = null;

  const style = document.createElement('style');
  style.id = 'yt-resizable-watch-columns-style';
  style.textContent = `
    ytd-watch-flexy.yt-resizable-watch-columns {
      --ytd-watch-flexy-sidebar-width: var(--yt-resizable-sidebar-width) !important;
      --ytd-watch-compact-thumbnail-width: var(--yt-resizable-thumbnail-ratio) !important;
    }
    ytd-watch-flexy.yt-resizable-watch-columns #columns {
      display: flex !important;
      align-items: flex-start !important;
    }
    ytd-watch-flexy.yt-resizable-watch-columns #primary {
      flex: 1 1 auto !important;
      min-width: ${LIMITS.primaryMin}px !important;
      width: auto !important;
    }
    ytd-watch-flexy.yt-resizable-watch-columns #secondary {
      display: block !important;
      flex: 0 0 var(--yt-resizable-sidebar-width) !important;
      width: var(--yt-resizable-sidebar-width) !important;
      min-width: var(--yt-resizable-sidebar-width) !important;
    }
    ytd-watch-flexy.yt-resizable-watch-columns #secondary
      a.ytLockupViewModelContentImage {
      width: var(--yt-resizable-thumbnail-ratio) !important;
      flex: 0 0 var(--yt-resizable-thumbnail-ratio) !important;
    }
    ytd-watch-flexy.yt-resizable-watch-columns #secondary
      ytd-compact-video-renderer #thumbnail {
      width: var(--yt-resizable-thumbnail-ratio) !important;
      flex: 0 0 var(--yt-resizable-thumbnail-ratio) !important;
    }
    .yt-resizable-watch-divider {
      position: fixed;
      z-index: 2147483647;
      width: 12px;
      transform: translateX(-50%);
      cursor: col-resize;
      touch-action: none;
      outline: none;
    }
    .yt-resizable-watch-divider::after {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 5px;
      width: 2px;
      border-radius: 2px;
      background: rgba(255, 255, 255, .32);
      transition: background-color .15s ease;
    }
    .yt-resizable-watch-divider:hover::after,
    .yt-resizable-watch-divider:focus-visible::after,
    .yt-resizable-watch-divider.is-dragging::after {
      background: #3ea6ff;
    }
    html.yt-resizable-watch-columns-dragging,
    html.yt-resizable-watch-columns-dragging * {
      cursor: col-resize !important;
      user-select: none !important;
    }
  `;
  document.documentElement.append(style);

  const sidebarDivider = makeDivider('Resize video and recommendations', 'sidebar');
  const thumbnailDivider = makeDivider('Resize recommendation thumbnails and titles', 'thumbnail');
  document.documentElement.append(sidebarDivider, thumbnailDivider);

  function loadSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Private browsing or a restrictive browser policy can disable storage.
    }
  }

  function isPlaybackUrl() {
    return location.pathname === '/watch' || location.pathname.startsWith('/live/');
  }

  function restoreSavedEdges() {
    if (!isPlaybackUrl()) return;
    settings = loadSettings();
    // YouTube replaces parts of ytd-watch-flexy in stages during SPA navigation.
    // Reapply after each of its first layout passes so its own styles cannot win.
    [0, 100, 350, 750].forEach((delay) => setTimeout(apply, delay));
  }

  function makeDivider(label, kind) {
    const divider = document.createElement('div');
    divider.className = 'yt-resizable-watch-divider';
    divider.dataset.kind = kind;
    divider.tabIndex = 0;
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.setAttribute('aria-label', `${label}. Drag left or right; double-click to reset.`);
    divider.addEventListener('pointerdown', startDrag);
    divider.addEventListener('dblclick', () => {
      settings = { ...DEFAULTS };
      saveSettings();
      apply();
    });
    divider.addEventListener('keydown', (event) => keyboardResize(event, kind));
    return divider;
  }

  function getWatch() {
    return document.querySelector('ytd-watch-flexy');
  }

  function getColumns(watch) {
    return watch?.querySelector('#columns');
  }

  function isResizableWatch(watch) {
    const columns = getColumns(watch);
    const secondary = watch?.querySelector('#secondary');
    return Boolean(columns && secondary && columns.getBoundingClientRect().width >=
      LIMITS.primaryMin + LIMITS.sidebarMin + LIMITS.columnGap);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizedSettings(watch) {
    const width = getColumns(watch)?.getBoundingClientRect().width || window.innerWidth;
    const maxSidebar = Math.max(LIMITS.sidebarMin, width - LIMITS.primaryMin - LIMITS.columnGap);
    settings.sidebar = clamp(Number(settings.sidebar) || DEFAULTS.sidebar, LIMITS.sidebarMin, maxSidebar);
    const minRatio = Math.min(0.8, LIMITS.thumbnailMin / settings.sidebar);
    const maxRatio = Math.max(minRatio, 1 - LIMITS.titleMin / settings.sidebar);
    settings.thumbnailRatio = clamp(Number(settings.thumbnailRatio) || DEFAULTS.thumbnailRatio, minRatio, maxRatio);
  }

  function apply() {
    const watch = getWatch();
    if (!isResizableWatch(watch)) {
      sidebarDivider.hidden = true;
      thumbnailDivider.hidden = true;
      watch?.classList.remove('yt-resizable-watch-columns');
      watch?.style.removeProperty('--yt-resizable-sidebar-width');
      watch?.style.removeProperty('--yt-resizable-thumbnail-ratio');
      return;
    }
    normalizedSettings(watch);
    watch.classList.add('yt-resizable-watch-columns');
    watch.style.setProperty('--yt-resizable-sidebar-width', `${Math.round(settings.sidebar)}px`);
    watch.style.setProperty('--yt-resizable-thumbnail-ratio', `${(settings.thumbnailRatio * 100).toFixed(2)}%`);
    positionDividers(watch);
  }

  function positionDividers(watch = getWatch()) {
    if (!isResizableWatch(watch)) return;
    const columns = getColumns(watch);
    const primary = watch.querySelector('#primary');
    const secondary = watch.querySelector('#secondary');
    const columnsRect = columns.getBoundingClientRect();
    const primaryRect = primary.getBoundingClientRect();
    const secondaryRect = secondary.getBoundingClientRect();
    const top = Math.max(columnsRect.top, 0);
    const height = Math.max(0, Math.min(columnsRect.bottom, window.innerHeight) - top);

    sidebarDivider.hidden = false;
    sidebarDivider.style.left = `${primaryRect.right}px`;
    sidebarDivider.style.top = `${top}px`;
    sidebarDivider.style.height = `${height}px`;
    sidebarDivider.setAttribute('aria-valuemin', String(LIMITS.sidebarMin));
    sidebarDivider.setAttribute('aria-valuemax', String(Math.round(columnsRect.width - LIMITS.primaryMin - LIMITS.columnGap)));
    sidebarDivider.setAttribute('aria-valuenow', String(Math.round(secondaryRect.width)));

    thumbnailDivider.hidden = false;
    thumbnailDivider.style.left = `${secondaryRect.left + secondaryRect.width * settings.thumbnailRatio}px`;
    thumbnailDivider.style.top = `${top}px`;
    thumbnailDivider.style.height = `${height}px`;
    thumbnailDivider.setAttribute('aria-valuemin', '0');
    thumbnailDivider.setAttribute('aria-valuemax', '100');
    thumbnailDivider.setAttribute('aria-valuenow', String(Math.round(settings.thumbnailRatio * 100)));
  }

  function startDrag(event) {
    const watch = getWatch();
    if (!isResizableWatch(watch) || event.button !== 0) return;
    event.preventDefault();
    activeDrag = { kind: event.currentTarget.dataset.kind, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add('is-dragging');
    document.documentElement.classList.add('yt-resizable-watch-columns-dragging');
  }

  document.addEventListener('pointermove', (event) => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    const watch = getWatch();
    const columns = getColumns(watch);
    const secondary = watch?.querySelector('#secondary');
    if (!columns || !secondary) return;
    const columnsRect = columns.getBoundingClientRect();
    if (activeDrag.kind === 'sidebar') {
      settings.sidebar = columnsRect.right - event.clientX;
    } else {
      const secondaryRect = secondary.getBoundingClientRect();
      settings.thumbnailRatio = (event.clientX - secondaryRect.left) / secondaryRect.width;
    }
    apply();
  });

  function finishDrag(event) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    const resizedSidebar = activeDrag.kind === 'sidebar';
    document.querySelectorAll('.yt-resizable-watch-divider').forEach((divider) => divider.classList.remove('is-dragging'));
    document.documentElement.classList.remove('yt-resizable-watch-columns-dragging');
    activeDrag = null;
    saveSettings();
    if (resizedSidebar) scheduleTheaterRefresh();
  }

  document.addEventListener('pointerup', finishDrag);
  document.addEventListener('pointercancel', finishDrag);

  function keyboardResize(event, kind) {
    const isDecrease = event.key === 'ArrowLeft';
    const isIncrease = event.key === 'ArrowRight';
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (kind === 'sidebar') settings.sidebar = event.key === 'Home' ? LIMITS.sidebarMin : window.innerWidth - LIMITS.primaryMin - LIMITS.columnGap;
      else settings.thumbnailRatio = event.key === 'Home' ? 0 : 1;
    } else if (isDecrease || isIncrease) {
      event.preventDefault();
      const amount = event.shiftKey ? 40 : 10;
      if (kind === 'sidebar') settings.sidebar += isDecrease ? amount : -amount;
      else settings.thumbnailRatio += (isDecrease ? -amount : amount) / 1000;
    } else {
      return;
    }
    apply();
    saveSettings();
    if (kind === 'sidebar') scheduleTheaterRefresh();
  }

  // YouTube sometimes keeps the player at its old scale after a width change.
  // Two 12ms T taps enter and immediately leave theater mode, forcing its layout
  // observer to recalculate without leaving the user in theater mode.
  function scheduleTheaterRefresh() {
    clearTimeout(theaterRefreshTimer);
    theaterRefreshTimer = setTimeout(() => {
      const fire = (type) => document.dispatchEvent(new KeyboardEvent(type, {
        key: 't',
        code: 'KeyT',
        keyCode: 84,
        which: 84,
        bubbles: true,
        cancelable: true,
      }));
      const tap = () => {
        fire('keydown');
        setTimeout(() => fire('keyup'), 12);
      };
      tap();
      setTimeout(tap, 40);
    }, 0);
  }

  window.addEventListener('resize', apply, { passive: true });
  window.addEventListener('scroll', () => positionDividers(), { passive: true, capture: true });
  document.addEventListener('yt-navigate-finish', restoreSavedEdges);
  window.addEventListener('popstate', restoreSavedEdges);

  new MutationObserver(() => requestAnimationFrame(apply)).observe(document.documentElement, { childList: true, subtree: true });
  resizeObserver = new ResizeObserver(() => positionDividers());
  resizeObserver.observe(document.documentElement);
  restoreSavedEdges();
})();

