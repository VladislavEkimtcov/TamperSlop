// ==UserScript==
// @name         9to5uiuc
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Auto-fill 8 hours for Monday-Friday on UIUC PTR System
// @author       Null
// @match        https://ptrsystem.uillinois.edu/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Check if we are on the timesheet entry page by looking for the input
    if (document.getElementById('mondayTimesheetHourValue')) {
        addFillButton();
    } else {
        // If loaded asynchronously, wait for it
        const observer = new MutationObserver((mutations, obs) => {
            if (document.getElementById('mondayTimesheetHourValue')) {
                addFillButton();
                obs.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function addFillButton() {
        if (document.getElementById('autoFill9to5Btn')) return;

        const btn = document.createElement('button');
        btn.id = 'autoFill9to5Btn';
        btn.innerText = 'Auto-Fill 8 Hrs (Mon-Fri)';
        btn.type = 'button';
        // Match the UIUC orange for the button to fit the aesthetic
        btn.style.cssText = 'margin-left: 15px; padding: 5px 15px; background-color: #E84A27; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; height: 30px;';

        btn.onclick = function() {
            // Set Mon-Fri to 8 hours
            const workDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
            workDays.forEach(day => {
                const hourInput = document.getElementById(day + 'TimesheetHourValue');
                if (hourInput) {
                    hourInput.value = '8';
                    hourInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const minSelect = document.getElementById(day + 'TimesheetMinuteValue');
                if (minSelect) {
                    minSelect.value = '0.00';
                    minSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });

            // Set weekends to 0
            const weekends = ['sunday', 'saturday'];
            weekends.forEach(day => {
                const hourInput = document.getElementById(day + 'TimesheetHourValue');
                if (hourInput) {
                    hourInput.value = '0';
                    hourInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const minSelect = document.getElementById(day + 'TimesheetMinuteValue');
                if (minSelect) {
                    minSelect.value = '0.00';
                    minSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        };

        // Try to insert it right after the Save/Submit buttons block
        const submitBtn = document.querySelector('input[value="Submit"], button[value="Submit"], input[value="Save"], button[value="Save"]');
        if (submitBtn && submitBtn.parentNode) {
            submitBtn.parentNode.appendChild(btn);
        } else {
            // Fallback
            document.body.prepend(btn);
        }
    }
})();