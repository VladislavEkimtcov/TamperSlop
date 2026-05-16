# Welcome, Agent! 🤖

This repository is a collection of custom Tampermonkey user scripts.

---

## Technical Constraints & Design Patterns

When editing or creating new scripts in this repository, please adhere to these patterns:

*   **No Heavy Dependencies**: Standardize on Vanilla JavaScript. Do not use jQuery or external UI packages.
*   **Framework Interoperability**: Since these scripts run in user environments, be mindful of standard Framework interfaces. (e.g., triggering `Event('change', { bubbles: true })` on inputs to update React/Vue component state, or inspecting internal properties like `__vue__`).
*   **Safe Injecting**: Check if elements exist before appending. Use fallback placements if optimal targets (like specific layout blocks) are missing.
*   **No Memory Leaks**: Ensure `MutationObserver` instances are disconnected when their job is complete, or reuse observers where applicable.
*   **Idempotency**: Avoid appending elements multiple times on asynchronous route changes. Use unique IDs (like `#autoFill9to5Btn`, `#timegem-panel`) to check if elements have already been initialized on the page.
