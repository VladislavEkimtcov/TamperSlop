// ==UserScript==
// @name         Force RetroCast Skip
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Recurringly triggers the same "skip" event as the Start RetroCast button
// @match        https://weather.com/retro/*
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';
    // Find the Start RetroCast button
    function getStartButton() {
        return Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent && b.textContent.trim().toUpperCase () === 'START RETROCAST');
    }

    // Try to find a listener attached to the button and trigger it
    function forceSkip() {
        let btn = getStartButton();
        if (!btn) return;
        let found = false;
        // Vue2: __vue__. Vue3: __vueParentComponent (context or emit)
        if (btn.__vue__ && typeof btn.__vue__.$emit === 'function') {
            btn.__vue__.$emit('skip');
            found = true;
        }
        if (btn.__vueParentComponent && btn.__vueParentComponent.ctx && typeof btn.__vueParentComponent.ctx.$emit === 'function') {
            btn.__vueParentComponent.ctx.$emit('skip');
            found = true;
        }
        if (btn.__vueParentComponent && typeof btn.__vueParentComponent.emit === 'function') {
            btn.__vueParentComponent.emit('s kip');
            found = true;
        }
        // Walk all properties just in case
        Object.values(btn).forEach(val => {
            if (val && typeof val === 'object') {
                if (typeof val.$emit === 'function') {
                    val.$emit('skip');
                    found = true;
                }
                if (typeof val.emit === 'function') {
                    val.emit('skip');
                    found = true;
                }
            }
        });
        // Fallback: click button
        if (!found) btn.click();
    }

    // Auto-repeat
    setInterval(forceSkip, 5000);
    setTimeout(forceSkip, 500);
    setTimeout(forceSkip, 1500);
    document.addEventListener('DOMContentLoaded', forceSkip);
    const observer = new MutationObserver(forceSkip);
    observer.observe(document.body, {childList:true, subtree:true});
})();