// ==UserScript==
// @name         Limit Countdown Timer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a live countdown timer after the "messages until %time%" text.
// @match        *://*.claude.ai/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Converts "1:30 PM" into a JavaScript Date object for the target time
    function getTargetDate(timeStr) {
        const [time, period] = timeStr.split(' ');
        let [hours, minutes] = time.split(':').map(Number);

        if (period.toUpperCase() === 'PM' && hours !== 12) hours += 12;
        if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;

        const target = new Date();
        target.setHours(hours, minutes, 0, 0);

        // If the target time has already passed today, assume it's for tomorrow
        if (target < new Date()) {
            target.setDate(target.getDate() + 1);
        }

        return target.getTime();
    }

    // Formats remaining milliseconds into HH:MM:SS
    function formatTimeRemaining(ms) {
        if (ms <= 0) return "00:00:00";

        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        return [
            hours.toString().padStart(2, '0'),
            minutes.toString().padStart(2, '0'),
            seconds.toString().padStart(2, '0')
        ].join(':');
    }

    // Scans the DOM for the text and injects the timer
    function injectTimer() {
        // Use a TreeWalker to safely find exact text nodes without breaking HTML
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;

        while ((node = walker.nextNode())) {
            const text = node.nodeValue;

            // Look for "until X:XX PM" or "until X:XX AM"
            const match = text.match(/until\s+(\d{1,2}:\d{2}\s*[AP]M)/i);

            if (match && node.parentNode) {
                // Prevent duplicate injections if the DOM mutates but doesn't wipe our span
                if (node.parentNode.querySelector('.custom-limit-countdown')) continue;

                const timeStr = match[1];
                const targetTimeMs = getTargetDate(timeStr);

                // Create the countdown element
                const span = document.createElement('span');
                span.className = 'custom-limit-countdown';
                span.style.fontWeight = 'bold';
                span.style.marginLeft = '6px';
                span.style.color = 'inherit'; // Blends with existing text color

                // Insert the span immediately after the "until %time%" text node
                node.parentNode.insertBefore(span, node.nextSibling);

                // Start the live interval
                const intervalId = setInterval(() => {
                    const now = Date.now();
                    const diff = targetTimeMs - now;

                    // If the node is no longer in the document (React re-rendered), kill the interval
                    if (!document.body.contains(span)) {
                        clearInterval(intervalId);
                        return;
                    }

                    if (diff <= 0) {
                        span.textContent = `(00:00:00)`;
                        clearInterval(intervalId);
                    } else {
                        span.textContent = `(${formatTimeRemaining(diff)})`;
                    }
                }, 1000);

                // Initial run so it doesn't wait 1 second to appear
                span.textContent = `(${formatTimeRemaining(targetTimeMs - Date.now())})`;
            }
        }
    }

    // Debounce the observer to avoid performance lag during heavy React DOM changes
    let debounceTimer;
    const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(injectTimer, 150);
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Run once on initial load just in case it's already there
    injectTimer();

})();