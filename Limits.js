// ==UserScript==
// @name         Limits
// @namespace    http://tampermonkey.net/
// @version      0.2.0
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
	const CURRENT_PERIOD_MS = 5 * 60 * 60 * 1000;
	const WEEKLY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
	const DAILY_LIMIT_TOKENS = 10000;
	const TEXT_SELECTOR = 'p, span, div';
	const CURRENT_CARD_SELECTOR = '[data-test-id="gxu-currently"]';
	const WEEKLY_CARD_SELECTOR = '[data-test-id="gxu-weekly"]';
	const BURN_METRICS_ROW_ID = 'limitsBurnMetricsRow';
	const BURN_METRICS_ID = 'limitsBurnMetrics';
	const WARNING_COLOR = 'var(--lumi-sys-color--error, var(--gem-sys-color--error, #d93025))';

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

	function formatInteger(value) {
		return Math.round(value).toLocaleString();
	}

	function formatTokenRate(tokensPerHour) {
		if (!Number.isFinite(tokensPerHour) || tokensPerHour <= 0) {
			return '0 tok/hr';
		}

		return `${formatInteger(tokensPerHour)} tok/hr`;
	}

	function formatBurnoutLabel(ms) {
		if (!Number.isFinite(ms)) {
			return '∞ burnout';
		}

		return `${formatClockDuration(ms)} burnout`;
	}

	function parseUsageDetails(text) {
		const match = normalizeWhitespace(text).match(/^\(?(\d+(?:\.\d+)?)% used(?:,\s*([\d,]+)\s+tokens)?\)?$/i);
		if (!match) {
			return null;
		}

		return {
			label: `${match[1]}% used`,
			percent: Number(match[1]),
			tokens: match[2] ? Number(match[2].replace(/,/g, '')) : NaN
		};
	}

	function parseUsageLabel(text) {
		const details = parseUsageDetails(text);
		return details ? details.label : '';
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
		const details = parseUsageDetails(text);
		return details ? details.percent : NaN;
	}

	function getUsageTokens(details) {
		if (!details || !Number.isFinite(details.percent)) {
			return NaN;
		}

		if (Number.isFinite(details.tokens)) {
			return details.tokens;
		}

		return Math.round(details.percent * DAILY_LIMIT_TOKENS / 100);
	}

	function getDailyLimitTokens(details) {
		const tokens = getUsageTokens(details);
		if (!details || !Number.isFinite(details.percent) || details.percent <= 0 || !Number.isFinite(tokens)) {
			return DAILY_LIMIT_TOKENS;
		}

		return Math.max(DAILY_LIMIT_TOKENS, Math.round(tokens / (details.percent / 100)));
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

	function ensureBurnMetricsNode(resetNode) {
		if (!(resetNode instanceof Element) || !resetNode.parentElement) {
			return null;
		}

		let row = document.getElementById(BURN_METRICS_ROW_ID);
		if (row && !row.contains(resetNode)) {
			row.remove();
			row = null;
		}

		if (!row) {
			row = document.createElement('div');
			row.id = BURN_METRICS_ROW_ID;
			row.style.display = 'flex';
			row.style.justifyContent = 'space-between';
			row.style.alignItems = 'center';
			row.style.gap = '12px';
			row.style.width = '100%';

			resetNode.parentElement.insertBefore(row, resetNode);
			row.appendChild(resetNode);
		}

		resetNode.style.flex = '1 1 auto';
		resetNode.style.minWidth = '0';

		let metricsNode = document.getElementById(BURN_METRICS_ID);
		if (metricsNode && !row.contains(metricsNode)) {
			metricsNode.remove();
			metricsNode = null;
		}

		if (!metricsNode) {
			metricsNode = document.createElement('p');
			metricsNode.id = BURN_METRICS_ID;
			row.appendChild(metricsNode);
		}

		metricsNode.className = resetNode.className;
		metricsNode.style.margin = '0';
		metricsNode.style.flex = '0 0 auto';
		metricsNode.style.textAlign = 'right';
		metricsNode.style.whiteSpace = 'nowrap';

		return metricsNode;
	}

	function getWeeklyUsageState() {
		const card = getWeeklyCard();
		if (!card) {
			return null;
		}

		const usageNode = findTextElement(card, (text) => Boolean(parseUsageLabel(text)));
		const usageDetails = usageNode ? parseUsageDetails(usageNode.textContent) : null;
		const resetNode = findTextElement(card, (text) => Boolean(parseWeeklyResetLabel(text)));
		if (!resetNode) {
			return null;
		}

		const label = parseWeeklyResetLabel(resetNode.textContent);
		const target = parseWeeklyResetDate(label, card);
		if (!label || !target) {
			return null;
		}

		const remainingMs = Math.max(0, target.getTime() - Date.now());
		setTextIfChanged(resetNode, `${label} (${formatDayClockDuration(remainingMs)})`);

		if (!usageDetails || !Number.isFinite(usageDetails.percent)) {
			return {
				isUnsustainable: false
			};
		}

		const elapsedMs = Math.max(0, Math.min(WEEKLY_PERIOD_MS, WEEKLY_PERIOD_MS - remainingMs));
		const actualRatePctPerMs = elapsedMs > 0 ? usageDetails.percent / elapsedMs : 0;
		const projectedDepletionMs = actualRatePctPerMs > 0 ? ((100 - usageDetails.percent) / actualRatePctPerMs) : Infinity;

		return {
			isUnsustainable: usageDetails.percent >= 100 || projectedDepletionMs < remainingMs - 1000
		};
	}

	function updateBurnMetrics(resetNode, target, usageDetails, weeklyState) {
		const metricsNode = ensureBurnMetricsNode(resetNode);
		if (!metricsNode) {
			return;
		}

		const tokens = getUsageTokens(usageDetails);
		if (!target || !Number.isFinite(tokens)) {
			metricsNode.textContent = '';
			metricsNode.style.display = 'none';
			metricsNode.removeAttribute('title');
			return;
		}

		const now = Date.now();
		const periodStart = target.getTime() - CURRENT_PERIOD_MS;
		const elapsedMs = Math.max(0, Math.min(CURRENT_PERIOD_MS, now - periodStart));
		const burnRatePerHour = elapsedMs > 0 ? (tokens * 60 * 60 * 1000) / elapsedMs : 0;
		const totalTokens = getDailyLimitTokens(usageDetails);
		const remainingTokens = Math.max(0, totalTokens - tokens);
		const burnoutMs = burnRatePerHour > 0 ? (remainingTokens / burnRatePerHour) * 60 * 60 * 1000 : Infinity;

		metricsNode.style.display = '';
		metricsNode.textContent = `${formatTokenRate(burnRatePerHour)} / ${formatBurnoutLabel(burnoutMs)}`;
		metricsNode.style.color = weeklyState && weeklyState.isUnsustainable ? WARNING_COLOR : '';
		metricsNode.title = weeklyState && weeklyState.isUnsustainable
			? 'Weekly usage pace is ahead of the weekly reset schedule.'
			: 'Token burn rate and projected time to deplete the current usage cap.';
	}

	function updateUpdatedLabel() {
		const node = findTextElement(document, (text) => /^Updated\s+.+/i.test(text));
		if (!node) {
			return;
		}

		node.style.fontWeight = '700';
	}

	function updateCurrentUsage(weeklyState) {
		const card = getCurrentCard();
		if (!card) {
			return;
		}

		const usageNode = findTextElement(card, (text) => Boolean(parseUsageLabel(text)));
		let usageDetails = usageNode ? parseUsageDetails(usageNode.textContent) : null;
		if (usageNode) {
			const label = parseUsageLabel(usageNode.textContent);
			const percent = parsePercent(usageNode.textContent);
			if (label && Number.isFinite(percent)) {
				const tokens = getUsageTokens(usageDetails);
				setTextIfChanged(usageNode, `(${label}, ${formatInteger(tokens)} tokens)`);
				usageDetails = {
					label,
					percent,
					tokens
				};
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
		updateBurnMetrics(resetNode, target, usageDetails, weeklyState);
	}

	function updateWeeklyReset() {
		return getWeeklyUsageState();
	}

	function sync() {
		state.lastUrl = location.href;
		updateUpdatedLabel();
		const weeklyState = updateWeeklyReset();
		updateCurrentUsage(weeklyState);
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

