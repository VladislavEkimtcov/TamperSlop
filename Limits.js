// ==UserScript==
// @name         Limits
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Adds live countdowns and token estimates to Gemini usage limits.
// @author       Null
// @match        https://gemini.google.com/usage*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
	'use strict';

	const INIT_KEY = '__limitsScriptInitialized';
	const POLL_INTERVAL_MS = 1000;
	const TEXT_SELECTOR = 'p, span, div';
	const CURRENT_CARD_SELECTOR = '[data-test-id="gxu-currently"]';
	const WEEKLY_CARD_SELECTOR = '[data-test-id="gxu-weekly"]';

	const state = {
		observer: null,
		timerId: 0,
		syncQueued: false,
		lastUrl: location.href
	};

	if (window.top !== window.self || window[INIT_KEY]) {
		return;
	}

	window[INIT_KEY] = true;

	function normalizeWhitespace(text) {
		return (text || '').replace(/\s+/g, ' ').trim();
	}

	function pad2(value) {
		return String(Math.max(0, value)).padStart(2, '0');
	}

	function formatClockDuration(ms) {
		const totalSeconds = Math.max(0, Math.floor(ms / 1000));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
	}

	function formatDayClockDuration(ms) {
		const totalSeconds = Math.max(0, Math.floor(ms / 1000));
		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		return `${days}d ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
	}

	function parseUsageLabel(text) {
		const match = normalizeWhitespace(text).match(/^\(?((?:\d+(?:\.\d+)?)% used)(?:,\s*[\d,]+\s+tokens)?\)?$/i);
		return match ? match[1] : '';
	}

	function parseDailyResetLabel(text) {
		const match = normalizeWhitespace(text).match(/^(Resets at \d{1,2}:\d{2} [AP]M)(?:\s+\(\d{2}:\d{2}:\d{2}\))?$/i);
		return match ? match[1] : '';
	}

	function parseWeeklyResetLabel(text) {
		const match = normalizeWhitespace(text).match(/^(Resets [A-Za-z]{3,9} \d{1,2} at \d{1,2}:\d{2} [AP]M)(?:\s+\(\d+d \d{2}:\d{2}:\d{2}\))?$/i);
		return match ? match[1] : '';
	}

	function isLeafMatch(element, matcher) {
		if (!(element instanceof Element)) {
			return false;
		}

		const text = normalizeWhitespace(element.textContent);
		if (!matcher(text)) {
			return false;
		}

		return !Array.from(element.children).some((child) => matcher(normalizeWhitespace(child.textContent)));
	}

	function findTextElement(root, matcher) {
		if (!root || typeof root.querySelectorAll !== 'function') {
			return null;
		}

		return Array.from(root.querySelectorAll(TEXT_SELECTOR)).find((element) => isLeafMatch(element, matcher)) || null;
	}

	function setTextIfChanged(element, value) {
		if (!(element instanceof Element)) {
			return;
		}

		if (element.textContent !== value) {
			element.textContent = value;
		}
	}

	function parsePercent(text) {
		const label = parseUsageLabel(text);
		const match = label.match(/(\d+(?:\.\d+)?)%/);
		return match ? Number(match[1]) : NaN;
	}

	function parseTimeParts(label) {
		const match = normalizeWhitespace(label).match(/(\d{1,2}):(\d{2})\s*([AP]M)$/i);
		if (!match) {
			return null;
		}

		let hours = Number(match[1]) % 12;
		const minutes = Number(match[2]);
		if (/pm/i.test(match[3])) {
			hours += 12;
		}

		return { hours, minutes };
	}

	function getNextDailyReset(label) {
		const parts = parseTimeParts(label);
		if (!parts) {
			return null;
		}

		const now = new Date();
		const target = new Date(now);
		target.setHours(parts.hours, parts.minutes, 0, 0);

		if (target.getTime() <= now.getTime()) {
			target.setDate(target.getDate() + 1);
		}

		return target;
	}

	function parseDateFromDatetime(scope) {
		if (!(scope instanceof Element)) {
			return null;
		}

		const candidates = [];
		if (scope.hasAttribute('datetime')) {
			candidates.push(scope.getAttribute('datetime'));
		}

		for (const element of scope.querySelectorAll('[datetime]')) {
			candidates.push(element.getAttribute('datetime'));
		}

		for (const value of candidates) {
			if (!value) {
				continue;
			}

			const parsed = new Date(value);
			if (!Number.isNaN(parsed.getTime())) {
				return parsed;
			}
		}

		return null;
	}

	function parseWeeklyResetDate(label, scope) {
		const fromDatetime = parseDateFromDatetime(scope);
		if (fromDatetime) {
			return fromDatetime;
		}

		const normalized = parseWeeklyResetLabel(label);
		const match = normalized.match(/^Resets ([A-Za-z]{3,9}) (\d{1,2}) at (\d{1,2}:\d{2} [AP]M)$/i);
		if (!match) {
			return null;
		}

		const year = new Date().getFullYear();
		const parsed = new Date(`${match[1]} ${match[2]}, ${year} ${match[3]}`);
		if (Number.isNaN(parsed.getTime())) {
			return null;
		}

		if (parsed.getTime() < Date.now() - 36 * 60 * 60 * 1000) {
			parsed.setFullYear(parsed.getFullYear() + 1);
		}

		return parsed;
	}

	function getCurrentCard() {
		return document.querySelector(CURRENT_CARD_SELECTOR);
	}

	function getWeeklyCard() {
		return document.querySelector(WEEKLY_CARD_SELECTOR);
	}

	function updateUpdatedLabel() {
		const node = findTextElement(document, (text) => /^Updated\s+.+/i.test(text));
		if (!node) {
			return;
		}

		node.style.fontWeight = '700';
	}

	function updateCurrentUsage() {
		const card = getCurrentCard();
		if (!card) {
			return;
		}

		const usageNode = findTextElement(card, (text) => Boolean(parseUsageLabel(text)));
		if (usageNode) {
			const label = parseUsageLabel(usageNode.textContent);
			const percent = parsePercent(label);
			if (label && Number.isFinite(percent)) {
				const tokens = Math.round(percent * 100);
				setTextIfChanged(usageNode, `(${label}, ${tokens} tokens)`);
			}
		}

		const resetNode = findTextElement(card, (text) => Boolean(parseDailyResetLabel(text)));
		if (!resetNode) {
			return;
		}

		const label = parseDailyResetLabel(resetNode.textContent);
		const target = getNextDailyReset(label);
		if (!label || !target) {
			return;
		}

		setTextIfChanged(resetNode, `${label} (${formatClockDuration(target.getTime() - Date.now())})`);
	}

	function updateWeeklyReset() {
		const card = getWeeklyCard();
		if (!card) {
			return;
		}

		const resetNode = findTextElement(card, (text) => Boolean(parseWeeklyResetLabel(text)));
		if (!resetNode) {
			return;
		}

		const label = parseWeeklyResetLabel(resetNode.textContent);
		const target = parseWeeklyResetDate(label, card);
		if (!label || !target) {
			return;
		}

		setTextIfChanged(resetNode, `${label} (${formatDayClockDuration(target.getTime() - Date.now())})`);
	}

	function sync() {
		state.lastUrl = location.href;
		updateUpdatedLabel();
		updateCurrentUsage();
		updateWeeklyReset();
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
		if (!state.observer) {
			state.observer = new MutationObserver(() => queueSync());
			state.observer.observe(document.documentElement, {
				subtree: true,
				childList: true,
				characterData: true
			});
		}

		if (!state.timerId) {
			state.timerId = window.setInterval(sync, POLL_INTERVAL_MS);
		}

		window.addEventListener('pageshow', queueSync, true);
		window.addEventListener('popstate', queueSync, true);
		window.addEventListener('pagehide', () => {
			if (state.observer) {
				state.observer.disconnect();
				state.observer = null;
			}

			if (state.timerId) {
				window.clearInterval(state.timerId);
				state.timerId = 0;
			}
		}, { once: true });
	}

	function init() {
		try {
			sync();
			installObservers();
		} catch (error) {
			console.error('Limits init failed', error);
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, { once: true });
	} else {
		init();
	}
})();

