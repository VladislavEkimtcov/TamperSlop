// ==UserScript==
// @name         Videos For The Blind
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Blanks YouTube thumbnails and hides watch-page video imagery while leaving layout and player controls in place.
// @author       Null
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
	'use strict';

	const STYLE_ID = 'videos-for-the-blind-style';
	const ROOT_ATTR = 'data-vftb-enabled';
	const ROUTE_ATTR = 'data-vftb-route';
	const THUMBNAIL_CONTAINER_SELECTOR = [
		'ytd-thumbnail',
		'a#thumbnail',
		'yt-thumbnail-view-model',
		'ytd-playlist-thumbnail',
		'ytd-moving-thumbnail-renderer'
	].join(', ');
	const THUMBNAIL_MEDIA_SELECTOR = [
		`${THUMBNAIL_CONTAINER_SELECTOR} > *`,
		`${THUMBNAIL_CONTAINER_SELECTOR} img`,
		`${THUMBNAIL_CONTAINER_SELECTOR} picture`,
		`${THUMBNAIL_CONTAINER_SELECTOR} source`,
		`${THUMBNAIL_CONTAINER_SELECTOR} video`,
		`${THUMBNAIL_CONTAINER_SELECTOR} canvas`,
		`${THUMBNAIL_CONTAINER_SELECTOR} svg`,
		`${THUMBNAIL_CONTAINER_SELECTOR} yt-image`,
		`${THUMBNAIL_CONTAINER_SELECTOR} .yt-core-image`,
		`${THUMBNAIL_CONTAINER_SELECTOR} [style*="background-image"]`
	].join(', ');
	const WATCH_MEDIA_SELECTOR = [
		'#movie_player .html5-video-container video',
		'#movie_player .html5-video-container img',
		'#movie_player .html5-video-container canvas',
		'#movie_player .ytp-cued-thumbnail-overlay',
		'#movie_player .ytp-cued-thumbnail-overlay-image',
		'#movie_player .ytp-spinner',
		'#movie_player .ytp-ad-image-overlay',
		'#movie_player .ytp-ce-element',
		'#movie_player .ytp-pause-overlay',
		'#movie_player .iv-branding',
		'#movie_player .annotation'
	].join(', ');
	const WATCH_PREVIEW_SELECTOR = [
		'#movie_player .ytp-tooltip.ytp-preview',
		'#movie_player .ytp-tooltip-bg',
		'#movie_player .ytp-storyboard-framepreview',
		'#movie_player .ytp-storyboard-framepreview-larger',
		'#movie_player .ytp-inline-preview-scrim'
	].join(', ');
	const THUMBNAIL_CONTAINER_SCOPE = `:is(${THUMBNAIL_CONTAINER_SELECTOR})`;
	const THUMBNAIL_MEDIA_SCOPE = `:is(${THUMBNAIL_MEDIA_SELECTOR})`;
	const WATCH_MEDIA_SCOPE = `:is(${WATCH_MEDIA_SELECTOR})`;
	const WATCH_PREVIEW_SCOPE = `:is(${WATCH_PREVIEW_SELECTOR})`;

	const state = {
		observer: null,
		syncQueued: false,
		lastUrl: ''
	};

	if (window.top !== window.self) {
		return;
	}

	if (window.__videosForTheBlindInitialized) {
		return;
	}

	window.__videosForTheBlindInitialized = true;

	function buildStyles() {
		return `
			:root[${ROOT_ATTR}="true"] {
				--vftb-blank-color: var(--yt-spec-base-background, #0f0f0f);
				--vftb-player-blank-color: #000;
			}

			:root[${ROOT_ATTR}="true"] ${THUMBNAIL_CONTAINER_SCOPE} {
				background: var(--vftb-blank-color) !important;
				background-image: none !important;
			}

			:root[${ROOT_ATTR}="true"] ${THUMBNAIL_MEDIA_SCOPE} {
				opacity: 0 !important;
				visibility: hidden !important;
				background-image: none !important;
			}

			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .html5-video-player,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .html5-video-container,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .video-stream {
				background: var(--vftb-player-blank-color) !important;
				background-image: none !important;
			}

			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] ${WATCH_MEDIA_SCOPE} {
				opacity: 0 !important;
				visibility: hidden !important;
			}

			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] ${WATCH_PREVIEW_SCOPE} {
				background: var(--vftb-player-blank-color) !important;
				background-image: none !important;
				box-shadow: none !important;
			}

			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] ${WATCH_PREVIEW_SCOPE} img,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] ${WATCH_PREVIEW_SCOPE} video,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] ${WATCH_PREVIEW_SCOPE} canvas {
				opacity: 0 !important;
				visibility: hidden !important;
			}

			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .ytp-gradient-top,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .ytp-gradient-bottom,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .ytp-chrome-top,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .ytp-chrome-bottom,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .ytp-progress-bar-container,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .caption-window,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .ytp-time-wrapper,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .ytp-right-controls,
			:root[${ROOT_ATTR}="true"][${ROUTE_ATTR}="watch"] #movie_player .ytp-left-controls {
				opacity: 1 !important;
				visibility: visible !important;
			}
		`;
	}

	function ensureStyle() {
		let style = document.getElementById(STYLE_ID);
		if (style) {
			if (style.textContent !== buildStyles()) {
				style.textContent = buildStyles();
			}
			return style;
		}

		style = document.createElement('style');
		style.id = STYLE_ID;
		style.textContent = buildStyles();

		const parent = document.head || document.documentElement;
		if (parent) {
			parent.appendChild(style);
		}

		return style;
	}

	function getRouteType() {
		return location.pathname === '/watch' ? 'watch' : 'browse';
	}

	function sync() {
		ensureStyle();
		document.documentElement.setAttribute(ROOT_ATTR, 'true');
		document.documentElement.setAttribute(ROUTE_ATTR, getRouteType());
		state.lastUrl = location.href;
	}

	function queueSync() {
		if (state.syncQueued) {
			return;
		}

		state.syncQueued = true;
		requestAnimationFrame(() => {
			state.syncQueued = false;
			sync();
		});
	}

	function installObservers() {
		if (state.observer) {
			return;
		}

		state.observer = new MutationObserver(() => {
			if (location.href !== state.lastUrl || !document.getElementById(STYLE_ID)) {
				queueSync();
			}
		});

		state.observer.observe(document.documentElement, {
			childList: true,
			subtree: true
		});

		window.addEventListener('yt-navigate-finish', queueSync, true);
		window.addEventListener('popstate', queueSync, true);
		window.addEventListener('pageshow', () => {
			installObservers();
			queueSync();
		}, true);
		window.addEventListener('pagehide', () => {
			if (state.observer) {
				state.observer.disconnect();
				state.observer = null;
			}
		}, { once: true });
	}

	function init() {
		try {
			sync();
			installObservers();
		} catch (error) {
			console.error('Videos For The Blind init failed', error);
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, { once: true });
		ensureStyle();
		document.documentElement.setAttribute(ROOT_ATTR, 'true');
		document.documentElement.setAttribute(ROUTE_ATTR, getRouteType());
	} else {
		init();
	}
})();

