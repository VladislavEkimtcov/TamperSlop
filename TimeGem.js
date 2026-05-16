// ==UserScript==
// @name         TimeGem
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Local Gemini timing and token throughput estimate.
// @author       NCSA
// @match        https://gemini.google.com/app*
// @match        https://gemini.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
	'use strict';

	const PANEL_ID = 'timegem-panel';
	const STYLE_ID = 'timegem-style';
	const TRIGGER_ID = 'timegem-trigger';
	const TOOLBAR_ITEM_ID = 'timegem-toolbar-item';
	const STABLE_FOR_MS = 1200;
	const POLL_INTERVAL_MS = 500;
	const ASK_GEMINI_TEXT = 'Ask Gemini';
	const DEBUG = false;

	function debug(event, payload) {
		if (!DEBUG) {
			return;
		}

		if (payload === undefined) {
			console.debug(`TimeGem ${event}`);
			return;
		}

		console.debug(`TimeGem ${event}`, payload);
	}

	const SELECTORS = {
		composer: '[role="textbox"][aria-label="Enter a prompt for Gemini"]',
		sendButton: 'button.send-button, button[aria-label*="Send"], button[aria-label*="Stop"]',
		sendIcon: '[data-mat-icon-name="send"]',
		response: [
			'[data-test-id="chat-history-container"] assistant-messages-primary [data-test-id="message"]',
			'assistant-messages-primary [data-test-id="message"]',
			'model-response .markdown-main-panel[aria-live]',
			'model-response [aria-live].markdown',
			'model-response [aria-live]'
		].join(', ')
	};

	const state = {
		session: null,
		lastAction: null,
		lastUrl: location.href,
		syncQueued: false,
		panel: null,
		toolbarItem: null,
		triggerButton: null,
		rows: null,
		statusNode: null
	};

	if (window.top !== window.self) {
		debug('frame-skip', { href: location.href });
		return;
	}

	function normalizeWhitespace(text) {
		return (text || '').replace(/\s+/g, ' ').trim();
	}

	function estimateTokens(text) {
		const normalized = normalizeWhitespace(text);
		if (!normalized) {
			return 0;
		}

		const parts = normalized.match(/[\p{L}\p{N}_]+|[^\s]/gu) || [];

		return parts.reduce((total, part) => {
			if (/^[\p{L}\p{N}_]+$/u.test(part)) {
				return total + Math.max(1, Math.ceil(part.length / 4));
			}

			return total + 1;
		}, 0);
	}

	function formatDuration(ms) {
		if (!ms || ms < 0) {
			return '0.00s';
		}

		return `${(ms / 1000).toFixed(2)}s`;
	}

	function formatRate(value) {
		if (!Number.isFinite(value) || value <= 0) {
			return '0.00';
		}

		return value.toFixed(2);
	}

	function buildStatsText(result) {
		if (!result) {
			return '';
		}

		return `${result.responseTokens} tok, ${formatRate(result.tokensPerSecond)} tok/s, ${formatDuration(result.totalMs)} tot, ${formatDuration(result.firstTokenMs)} ttft`;
	}

	function getComposer() {
		return document.querySelector(SELECTORS.composer);
	}

	function getComposerText() {
		const composer = getComposer();
		const text = composer ? normalizeWhitespace(composer.innerText) : '';
		debug('composer-read', { found: Boolean(composer), length: text.length });
		return text;
	}

	function getSendButton() {
		return document.querySelector(SELECTORS.sendButton);
	}

	function getToolsButton() {
		return Array.from(document.querySelectorAll('button')).find((button) => {
			const label = button.getAttribute('aria-label') || '';
			const text = normalizeWhitespace(button.innerText);
			const icon = button.querySelector('[data-mat-icon-name="page_info"], [fonticon="page_info"]');

			return label === 'Tools' || text === 'Tools' || Boolean(icon && /tools/i.test(`${label} ${text}`));
		}) || null;
	}

	function getToolsAnchor() {
		const button = getToolsButton();

		if (!button) {
			return null;
		}

		return button.closest('.toolbox-drawer-button-container') || button.parentElement;
	}

	function getSendIcon(button) {
		const scope = button || document;
		return scope.querySelector(SELECTORS.sendIcon);
	}

	function getResponseCandidates() {
		const seen = new Set();
		const candidates = Array.from(document.querySelectorAll(SELECTORS.response)).filter((node) => {
			if (!(node instanceof Element) || seen.has(node)) {
				return false;
			}

			seen.add(node);
			return Boolean(normalizeWhitespace(node.innerText));
		});

		debug('response-candidates', { count: candidates.length });
		return candidates;
	}

	function getResponseKey(response, index) {
		if (!response) {
			return '';
		}

		return response.id
			|| response.getAttribute('data-response-id')
			|| response.getAttribute('data-message-id')
			|| `${response.getAttribute('data-test-id') || response.tagName.toLowerCase()}:${index}`;
	}

	function getLatestResponse() {
		const responses = getResponseCandidates();
		const node = responses.at(-1) || null;

		if (!node) {
			debug('response-read', { found: false });
			return null;
		}

		const latest = {
			node,
			key: getResponseKey(node, responses.length - 1)
		};

		debug('response-read', { found: true, key: latest.key, length: normalizeWhitespace(node.innerText).length });
		return latest;
	}

	function replaceTextNode(node, value) {
		if (!node) {
			return;
		}

		node.__timegemOriginalText ||= node.textContent;
		node.textContent = value;
	}

	function restoreTextNode(node) {
		if (!node || node.__timegemOriginalText === undefined) {
			return;
		}

		node.textContent = node.__timegemOriginalText;
	}

	function getOriginalAttributeName(attribute) {
		return `data-timegem-original-${attribute.replace(/[^a-z0-9]+/gi, '-')}`;
	}

	function getAskGeminiTargets() {
		const targets = [];

		for (const element of document.querySelectorAll('[data-placeholder], [placeholder], [title]')) {
			for (const attribute of ['data-placeholder', 'placeholder', 'title']) {
				const value = element.getAttribute(attribute);
				if (value === ASK_GEMINI_TEXT || element.getAttribute(getOriginalAttributeName(attribute)) === ASK_GEMINI_TEXT) {
					targets.push({ type: 'attribute', element, attribute });
				}
			}
		}

		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const value = normalizeWhitespace(node.textContent);
			if (value === ASK_GEMINI_TEXT || node.__timegemOriginalText === ASK_GEMINI_TEXT) {
				targets.push({ type: 'text', node });
			}
		}

		return targets;
	}

	function setAskGeminiText(value) {
		if (!document.body) {
			return;
		}

		let mutated = 0;

		for (const target of getAskGeminiTargets()) {
			if (target.type === 'attribute') {
				const key = getOriginalAttributeName(target.attribute);
				if (!target.element.hasAttribute(key)) {
					target.element.setAttribute(key, target.element.getAttribute(target.attribute) || '');
				}
				target.element.setAttribute(target.attribute, value);
				mutated++;
				continue;
			}

			replaceTextNode(target.node, value);
			mutated++;
		}

		debug('ask-gemini-mutate', { mode: 'set', mutated, value });
	}

	function restoreAskGeminiText() {
		if (!document.body) {
			return;
		}

		let restored = 0;

		for (const element of document.querySelectorAll('[data-placeholder], [placeholder], [title]')) {
			for (const attribute of ['data-placeholder', 'placeholder', 'title']) {
				const key = getOriginalAttributeName(attribute);
				const original = element.getAttribute(key);
				if (original !== null) {
					element.setAttribute(attribute, original);
					restored++;
				}
			}
		}

		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			restoreTextNode(node);
			restored++;
		}

		debug('ask-gemini-mutate', { mode: 'restore', restored });
	}

	function takeSnapshot() {
		const sendButton = getSendButton();
		const sendIcon = getSendIcon(sendButton);
		const latestResponse = getLatestResponse();
		const response = latestResponse ? latestResponse.node : null;
		const sendButtonLabel = sendButton ? sendButton.getAttribute('aria-label') || '' : '';
		const responseBusy = Boolean(
			(response && response.getAttribute('aria-busy') === 'true')
			|| document.querySelector('[aria-busy="true"]')
		);
		const sendIconHidden = sendIcon ? sendIcon.classList.contains('hidden') : false;

		return {
			now: performance.now(),
			url: location.href,
			composerText: getComposerText(),
			sendButtonLabel,
			sendButtonDisabled: Boolean(sendButton && (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true')),
			sendIconHidden,
			responseKey: latestResponse ? latestResponse.key : '',
			responseBusy,
			responseText: response ? normalizeWhitespace(response.innerText) : '',
			isGenerating: /stop/i.test(sendButtonLabel) || responseBusy || sendIconHidden
		};
	}

	function ensurePanel() {
		if (!document.body) {
			return;
		}

		if (!document.getElementById(STYLE_ID)) {
			const style = document.createElement('style');
			style.id = STYLE_ID;
			style.textContent = `
				#${PANEL_ID} {
					position: absolute;
					bottom: calc(100% + 8px);
					left: calc(100% - 40px);
					right: auto;
					z-index: 2147483647;
					width: 260px;
					padding: 12px 14px;
					border: 1px solid rgba(255, 255, 255, 0.12);
					border-radius: 14px;
					background: rgba(18, 18, 18, 0.92);
					color: #f8fafc;
					box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
					font: 12px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
					backdrop-filter: blur(10px);
					opacity: 0;
					visibility: hidden;
					pointer-events: none;
					transform: translateY(4px);
					transform-origin: bottom left;
					transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s ease;
				}

				#${TOOLBAR_ITEM_ID} {
					position: relative;
					display: flex;
					align-items: center;
					justify-content: center;
					flex: 0 0 auto;
					width: 40px;
				}

				.timegem-tools-anchor {
					display: flex;
					align-items: center;
					gap: 8px;
				}

				#${TRIGGER_ID} {
					display: inline-flex;
					align-items: center;
					justify-content: center;
					width: 40px;
					height: 40px;
					padding: 0;
					border: 0;
					border-radius: 999px;
					background: transparent;
					color: inherit;
					cursor: pointer;
					font: inherit;
				}

				#${TRIGGER_ID} svg {
					display: block;
					width: 18px;
					height: 18px;
					fill: currentColor;
					transform: translate(0.5px, -0.5px);
				}

				#${TRIGGER_ID}:hover,
				#${TRIGGER_ID}:focus-visible {
					background: rgba(255, 255, 255, 0.08);
					outline: none;
				}

				#${PANEL_ID} table {
					width: 100%;
					border-collapse: collapse;
					table-layout: fixed;
				}

				#${TOOLBAR_ITEM_ID}:hover #${PANEL_ID},
				#${TOOLBAR_ITEM_ID}:focus-within #${PANEL_ID} {
					opacity: 1;
					visibility: visible;
					pointer-events: auto;
					transform: translateY(0);
				}

				#${PANEL_ID} .timegem-header {
					display: flex;
					align-items: baseline;
					justify-content: space-between;
					gap: 8px;
					margin-bottom: 10px;
				}

				#${PANEL_ID} .timegem-title {
					font-size: 14px;
					font-weight: 700;
					letter-spacing: 0.02em;
				}

				#${PANEL_ID} .timegem-status {
					color: #93c5fd;
					font-size: 11px;
					text-transform: uppercase;
					letter-spacing: 0.08em;
				}

				#${PANEL_ID} th,
				#${PANEL_ID} td {
					padding: 3px 0;
				}

				#${PANEL_ID} th {
					color: #94a3b8;
					font-weight: 400;
					text-align: left;
				}

				#${PANEL_ID} td {
					text-align: right;
					font-variant-numeric: tabular-nums;
					white-space: nowrap;
				}

			`;
			document.head.appendChild(style);
		}

		if (!state.panel) {
			const panel = document.createElement('aside');
			panel.id = PANEL_ID;

			const header = document.createElement('div');
			header.className = 'timegem-header';

			const title = document.createElement('div');
			title.className = 'timegem-title';
			title.textContent = 'TimeGem';

			const status = document.createElement('div');
			status.className = 'timegem-status';
			status.textContent = 'Ready';

			header.append(title, status);

			const list = document.createElement('table');
			const body = document.createElement('tbody');
			for (const [label, row, value] of [
				['Prompt tokens', 'promptTokens', '0'],
				['Response tokens', 'responseTokens', '0'],
				['TTFT', 'firstToken', '0.00s'],
				['Total time', 'totalTime', '0.00s'],
				['Tokens / sec', 'tokensPerSecond', '0.00']
			]) {
				const tableRow = document.createElement('tr');

				const term = document.createElement('th');
				term.textContent = label;

				const description = document.createElement('td');
				description.dataset.row = row;
				description.textContent = value;

				tableRow.append(term, description);
				body.appendChild(tableRow);
			}
			list.appendChild(body);

			panel.append(header, list);
			state.panel = panel;
			state.statusNode = panel.querySelector('.timegem-status');
			state.rows = {
				promptTokens: panel.querySelector('[data-row="promptTokens"]'),
				responseTokens: panel.querySelector('[data-row="responseTokens"]'),
				firstToken: panel.querySelector('[data-row="firstToken"]'),
				totalTime: panel.querySelector('[data-row="totalTime"]'),
				tokensPerSecond: panel.querySelector('[data-row="tokensPerSecond"]')
			};
			debug('panel-injected', { id: PANEL_ID });
		}

		const anchor = getToolsAnchor();
		if (!anchor) {
			return;
		}

		anchor.classList.add('timegem-tools-anchor');

		if (!state.toolbarItem || !anchor.contains(state.toolbarItem)) {
			const toolbarItem = document.createElement('div');
			toolbarItem.id = TOOLBAR_ITEM_ID;

			const triggerButton = document.createElement('button');
			triggerButton.id = TRIGGER_ID;
			triggerButton.type = 'button';
			triggerButton.className = 'mat-mdc-tooltip-trigger';
			triggerButton.setAttribute('aria-label', 'TimeGem');
			triggerButton.setAttribute('title', 'TimeGem');

			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('viewBox', '0 -960 960 960');
			svg.setAttribute('aria-hidden', 'true');
			svg.setAttribute('focusable', 'false');

			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', 'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q111 0 190.5-78.5T750-430q0-100-74-174.5T500-679q-69 0-119.5 40T311-537l169 57 105-152-70 200-290-98q-28 96 8.5 185T332-214q58 54 148 54Z');

			svg.appendChild(path);
			triggerButton.appendChild(svg);
			toolbarItem.appendChild(triggerButton);

			state.toolbarItem = toolbarItem;
			state.triggerButton = triggerButton;
		}

		if (!anchor.contains(state.toolbarItem)) {
			anchor.appendChild(state.toolbarItem);
		}

		if (state.panel.parentElement !== state.toolbarItem) {
			state.toolbarItem.appendChild(state.panel);
		}
	}

	function setMetric(name, value) {
		if (state.rows && state.rows[name]) {
			state.rows[name].textContent = value;
		}
	}

	function setStatus(value) {
		if (state.statusNode) {
			state.statusNode.textContent = value;
		}
	}

	function renderIdle(result) {
		ensurePanel();
		debug('render-idle', result ? {
			promptTokens: result.promptTokens,
			responseTokens: result.responseTokens,
			totalMs: result.totalMs
		} : { ready: true });
		setStatus(result ? 'Last run' : 'Ready');
		setMetric('promptTokens', String(result ? result.promptTokens : 0));
		setMetric('responseTokens', String(result ? result.responseTokens : 0));
		setMetric('firstToken', formatDuration(result ? result.firstTokenMs : 0));
		setMetric('totalTime', formatDuration(result ? result.totalMs : 0));
		setMetric('tokensPerSecond', formatRate(result ? result.tokensPerSecond : 0));
		if (result) {
			setAskGeminiText(buildStatsText(result));
		} else {
			restoreAskGeminiText();
		}
	}

	function renderSession(session, now) {
		ensurePanel();
		restoreAskGeminiText();
		debug('render-session', {
			promptPreview: session.promptPreview,
			responseTokens: session.responseTokens,
			firstResponseAt: session.firstResponseAt,
			isFinalizing: session.isFinalizing
		});

		const totalMs = now - session.startedAt;
		const firstTokenMs = session.firstResponseAt ? session.firstResponseAt - session.startedAt : 0;
		const tokensPerSecond = totalMs > 0 ? session.responseTokens / (totalMs / 1000) : 0;

		setStatus(session.isFinalizing ? 'Settling' : 'Timing');
		setMetric('promptTokens', String(session.promptTokens));
		setMetric('responseTokens', String(session.responseTokens));
		setMetric('firstToken', formatDuration(firstTokenMs));
		setMetric('totalTime', formatDuration(totalMs));
		setMetric('tokensPerSecond', formatRate(tokensPerSecond));
	}

	function capturePrompt(source) {
		const promptText = getComposerText();
		if (!promptText) {
			debug('capture-prompt', { source, captured: false });
			return;
		}

		state.lastAction = {
			source,
			at: performance.now(),
			promptText
		};
		debug('capture-prompt', { source, captured: true, length: promptText.length });
	}

	function isComposerNode(node) {
		if (!node) {
			return false;
		}

		if (node instanceof Element) {
			return Boolean(node.closest(SELECTORS.composer));
		}

		if (node.parentElement) {
			return Boolean(node.parentElement.closest(SELECTORS.composer));
		}

		return false;
	}

	function beginSession(snapshot) {
		const promptText = state.lastAction && snapshot.now - state.lastAction.at < 4000
			? state.lastAction.promptText
			: snapshot.composerText;

		const session = {
			startedAt: snapshot.now,
			promptText,
			promptPreview: normalizeWhitespace(promptText).slice(0, 72) || 'Untitled prompt',
			promptTokens: estimateTokens(promptText),
			baselineResponseKey: snapshot.responseKey,
			baselineResponseText: snapshot.responseText,
			responseKey: '',
			responseText: '',
			responseTokens: 0,
			firstResponseAt: 0,
			lastContentChangeAt: 0,
			idleSince: 0,
			isFinalizing: false
		};

		state.session = session;
		debug('session-begin', {
			promptPreview: session.promptPreview,
			promptTokens: session.promptTokens,
			responseKey: session.baselineResponseKey
		});
		renderSession(session, snapshot.now);
	}

	function updateSession(snapshot) {
		const session = state.session;
		if (!session) {
			return;
		}

		const tracksCurrentResponse = snapshot.responseKey && (
			snapshot.responseKey !== session.baselineResponseKey ||
			snapshot.responseKey === session.responseKey ||
			snapshot.responseText !== session.baselineResponseText
		);

		if (tracksCurrentResponse) {
			if (snapshot.responseKey !== session.responseKey) {
				session.responseKey = snapshot.responseKey;
				session.responseText = '';
				session.responseTokens = 0;
				debug('session-response-switch', { responseKey: session.responseKey });
			}

			if (snapshot.responseText !== session.responseText) {
				session.responseText = snapshot.responseText;
				session.responseTokens = estimateTokens(snapshot.responseText);
				session.lastContentChangeAt = snapshot.now;
				debug('session-response-update', {
					responseKey: session.responseKey,
					responseTokens: session.responseTokens,
					textLength: snapshot.responseText.length
				});

				if (!session.firstResponseAt && session.responseText) {
					session.firstResponseAt = snapshot.now;
					debug('session-first-token', { responseKey: session.responseKey, firstTokenMs: 0 });
				}
			}
		}

		if (snapshot.isGenerating) {
			session.idleSince = 0;
			session.isFinalizing = false;
		} else {
			session.idleSince = session.idleSince || snapshot.now;
			session.isFinalizing = true;
		}

		renderSession(session, snapshot.now);
	}

	function shouldFinalize(snapshot) {
		const session = state.session;
		if (!session || snapshot.isGenerating) {
			return false;
		}

		if (!session.responseText) {
			return snapshot.now - session.startedAt >= STABLE_FOR_MS;
		}

		const stableSince = Math.max(session.idleSince || 0, session.lastContentChangeAt || 0);
		return stableSince > 0 && snapshot.now - stableSince >= STABLE_FOR_MS;
	}

	function finishSession(snapshot) {
		const session = state.session;
		if (!session) {
			return;
		}

		const finishedAt = snapshot.now;
		const totalMs = finishedAt - session.startedAt;
		const firstTokenMs = session.firstResponseAt ? session.firstResponseAt - session.startedAt : 0;
		const tokensPerSecond = totalMs > 0 ? session.responseTokens / (totalMs / 1000) : 0;

		const result = {
			promptTokens: session.promptTokens,
			responseTokens: session.responseTokens,
			totalMs,
			firstTokenMs,
			tokensPerSecond,
			promptPreview: session.promptPreview
		};

		state.session = null;
		state.lastAction = null;
		debug('session-finish', {
			promptTokens: result.promptTokens,
			responseTokens: result.responseTokens,
			totalMs: result.totalMs,
			firstTokenMs: result.firstTokenMs
		});

		debug('summary', {
			prompt: session.promptText,
			promptTokens: result.promptTokens,
			responseTokens: result.responseTokens,
			firstTokenMs: result.firstTokenMs,
			totalMs: result.totalMs,
			tokensPerSecond: Number(result.tokensPerSecond.toFixed(2))
		});

		renderIdle(result);
	}

	function resetForNavigation() {
		state.session = null;
		state.lastAction = null;
		state.lastUrl = location.href;
		debug('navigation-reset', { url: state.lastUrl });
		renderIdle(null);
	}

	function sync() {
		ensurePanel();
		debug('sync-start', { url: location.href, session: Boolean(state.session) });

		if (location.href !== state.lastUrl) {
			resetForNavigation();
		}

		const snapshot = takeSnapshot();
		debug('snapshot', {
			sendButtonLabel: snapshot.sendButtonLabel,
			responseKey: snapshot.responseKey,
			responseBusy: snapshot.responseBusy,
			isGenerating: snapshot.isGenerating,
			composerLength: snapshot.composerText.length
		});

		if (!state.session && snapshot.isGenerating) {
			beginSession(snapshot);
		}

		if (state.session) {
			updateSession(snapshot);

			if (shouldFinalize(snapshot)) {
				finishSession(snapshot);
			}
		}
	}

	function queueSync() {
		if (state.syncQueued) {
			debug('sync-queued', { skipped: true });
			return;
		}

		state.syncQueued = true;
		debug('sync-queued', { skipped: false });
		requestAnimationFrame(() => {
			state.syncQueued = false;
			sync();
		});
	}

	function installObservers() {
		debug('observers-install');
		document.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}

			if (target.closest(SELECTORS.sendButton)) {
				capturePrompt('click');
			}
		}, true);

		document.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
				return;
			}

			if (!isComposerNode(event.target)) {
				return;
			}

			capturePrompt('keyboard');
		}, true);

		const observer = new MutationObserver(() => queueSync());
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ['aria-label', 'aria-busy', 'aria-disabled', 'class']
		});
		debug('mutation-observer-ready', { target: 'document.documentElement' });

		window.setInterval(sync, POLL_INTERVAL_MS);
		debug('polling-start', { intervalMs: POLL_INTERVAL_MS });
	}

	function init() {
		debug('boot', { readyState: document.readyState, href: location.href });

		try {
			ensurePanel();
			renderIdle(null);
			installObservers();
			sync();
			debug('boot-complete');
		} catch (error) {
			console.error('TimeGem init failed', error);
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, { once: true });
	} else {
		init();
	}
})();

