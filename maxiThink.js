// ==UserScript==
// @name         Gemini Auto-Switcher: 3.6 Flash & Thinking
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Automates the UI clicks to set Gemini 3.6 Flash and High thinking level.
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

    // Utility: Find a visible <gem-menu-item> by its trimmed label text
    function getMenuItemByLabel(label) {
        const items = document.querySelectorAll('gem-menu-item');
        return Array.from(items).find(item => {
            const labelEl = item.querySelector('.label');
            return labelEl && labelEl.textContent.trim() === label && item.getBoundingClientRect().width > 0;
        }) || null;
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

    // Utility: Simulate the pointer hovering over an element (opens hover submenus)
    function simulateHover(el) {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'].forEach(type => {
            const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
            el.dispatchEvent(new Ctor(type, {
                view: window,
                bubbles: !type.endsWith('enter'),
                cancelable: true,
                clientX: x,
                clientY: y
            }));
        });
    }

    // Main execution sequence
    async function runSequence() {
        try {
            // Wait for initial page load to settle
            await randomSleep(800, 1500);

            // 1. Open the model menu
            const pill = await waitForElement(() => document.querySelector('.logo-pill-label-container'));
            await randomSleep(200, 600);
            simulateHumanClick(pill);
            await randomSleep(300, 700);

            // 2. Select 3.6 Flash
            const model = await waitForElement(() => getElementByText(" 3.6 Flash "));
            simulateHumanClick(model);
            await randomSleep(400, 800);

            // 3. Re-open the menu (per your logic to access the thinking toggle)
            const pillReopen = await waitForElement(() => document.querySelector('.logo-pill-label-container'));
            simulateHumanClick(pillReopen);
            await randomSleep(300, 650);

            // 4. Hover the "Thinking level" item to open its submenu
            const thinkItem = await waitForElement(() => getMenuItemByLabel('Thinking level'));
            simulateHover(thinkItem);
            await randomSleep(350, 750);

            // 5. Select "High" (fall back to a click on the trigger if hover didn't open the submenu)
            let highItem;
            try {
                highItem = await waitForElement(() => getMenuItemByLabel('High'), 2000);
            } catch (_) {
                simulateHumanClick(thinkItem);
                await randomSleep(350, 750);
                highItem = await waitForElement(() => getMenuItemByLabel('High'));
            }
            simulateHumanClick(highItem);

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
