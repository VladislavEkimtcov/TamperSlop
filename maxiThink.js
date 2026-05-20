// ==UserScript==
// @name         Gemini Auto-Switcher: 3.5 Flash & Thinking
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automates the UI clicks to set Gemini 3.5 Flash and Complex problem solving.
// @author       You
// @match        https://gemini.google.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Utility: Sleep for a random interval between min and max milliseconds
    const randomSleep = (min, max) => new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

    // Utility: Find element by exact text content using XPath
    function getElementByText(text) {
        const xpath = `//*[text()="${text}"]`;
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue;
    }

    // Utility: Wait for an element to exist in the DOM and be visible
    async function waitForElement(finderFn, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = finderFn();
            // Check if element exists and has dimensions (is visible)
            if (el && el.getBoundingClientRect().width > 0) {
                return el;
            }
            await randomSleep(50, 150); // Fast polling with slight jitter
        }
        throw new Error('Element not found within timeout period.');
    }

    // Utility: Simulate a human click at a random point within the element's bounding box
    function simulateHumanClick(el) {
        const rect = el.getBoundingClientRect();

        // Pick a random coordinate within the element's visible box
        const x = rect.left + (Math.random() * rect.width);
        const y = rect.top + (Math.random() * rect.height);

        // Dispatch a realistic sequence of mouse events
        const events = ['mouseover', 'mousedown', 'mouseup', 'click'];
        events.forEach(eventType => {
            const event = new MouseEvent(eventType, {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                buttons: eventType === 'mouseover' ? 0 : 1 // 1 is left click
            });
            el.dispatchEvent(event);
        });
    }

    // Main execution sequence
    async function runSequence() {
        try {
            // Wait for initial page load to settle
            await randomSleep(800, 1500);

            // 1. Open the model menu
            const pill = await waitForElement(() => document.querySelector('.logo-pill-label-container'));
            simulateHumanClick(pill);
            await randomSleep(300, 700);

            // 2. Select 3.5 Flash
            const model = await waitForElement(() => getElementByText(" 3.5 Flash "));
            simulateHumanClick(model);
            await randomSleep(400, 800);

            // 3. Re-open the menu (per your logic to access the thinking toggle)
            const pillReopen = await waitForElement(() => document.querySelector('.logo-pill-label-container'));
            simulateHumanClick(pillReopen);
            await randomSleep(300, 650);

            // 4. Click the thinking level dropdown
            const think = await waitForElement(() => document.querySelector('[value="thinking_level"]'));
            simulateHumanClick(think);
            await randomSleep(350, 750);

            // 5. Select "Complex problem solving"
            const extendedElement = await waitForElement(() => getElementByText("Complex problem solving"));
            simulateHumanClick(extendedElement);

            console.log("Gemini Auto-Switcher: Successfully applied preferences.");

        } catch (error) {
            console.warn("Gemini Auto-Switcher stopped: ", error.message);
        }
    }

    // Start the sequence once the DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runSequence);
    } else {
        runSequence();
    }

})();