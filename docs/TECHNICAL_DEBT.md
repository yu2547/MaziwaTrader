# Technical Debt Log

Known issues that have been investigated and deliberately deferred, with enough detail to fix them later without re-investigating from scratch.

---

## TD-1: Repeating render cycle in `app-content.jsx`'s offline-handling effect

**Status:** Deferred (recorded 2026-07-25). Not fixed. Do not fix without explicit approval — this file is a record, not a task queue.

**Location:** [src/app/app-content.jsx](../src/app/app-content.jsx), the `useEffect` around line 86 (`// Handle offline scenarios - don't wait indefinitely for API`).

**Severity:** Low–Medium. Does not freeze the tab or trip React's runaway-render safeguard (unlike the `AuthWrapper.tsx` bug it was found alongside) — it's rate-limited by its own `setTimeout`, so it repeats roughly every 3 seconds rather than in a tight synchronous loop.

**How it was found:** While verifying the `AuthWrapper.tsx` infinite-loop fix, that fix's success let rendering proceed further than before, exposing this second, previously-masked issue with the same root-cause shape in a different file.

### Root cause

```jsx
useEffect(() => {
    if (!isOnline && is_loading) {
        console.log('[Offline] Detected offline state, setting timeout to show dashboard');
        const timeout = setTimeout(() => {
            console.log('[Offline] Timeout reached, showing dashboard in offline mode');
            setIsLoading(false);
            setIsApiInitialized(true);
            if (!app.dbot_store) init();
        }, 3000);
        setOfflineTimeout(timeout);
    } else if (isOnline && offline_timeout) {
        clearTimeout(offline_timeout);
        setOfflineTimeout(null);
    }
    return () => { if (offline_timeout) clearTimeout(offline_timeout); };
}, [isOnline, is_loading, offline_timeout, app.dbot_store]);
```

`offline_timeout` (the timer ID returned by `setTimeout`) is both **written by** this effect (`setOfflineTimeout(timeout)`) and **listed in its own dependency array**. Every time the effect sets a new timeout, the new (different) timer ID is a genuine value change, so the effect re-runs — and while still offline and still loading, it takes the same branch again, creating another new timeout, another value change, another re-run. This repeats roughly on the interval of the `setTimeout` itself (~3s) for as long as `isOnline` is false and `is_loading` remains true.

### Impact

- Confirmed reproducible: simulating an offline `navigator.onLine` state causes `[Offline] Detected offline state...` to log repeatedly, indefinitely, while offline.
- Does not hang the tab or block interaction (verified — `javascript_tool` and console reads worked fine throughout).
- Real-world exposure is bounded to genuinely offline users (airplane mode, dropped wifi) who stay in that state — a legitimate scenario, not just a sandbox artifact, though the severity is capped by the fact that it doesn't block the UI, only creates redundant repeated work (redundant `setTimeout`s, redundant `init()` risk if `app.dbot_store` guard doesn't hold as expected across repeats).

### Recommended fix

Same class of fix as the `AuthWrapper.tsx` one: break the self-referential dependency. Simplest safe option — drop `offline_timeout` from the dependency array (it doesn't need to be a reactive trigger, only a value to read/clear), e.g. via a ref instead of state for the timer ID, or by guarding the effect body so it only arms a new timeout when one isn't already pending. Needs the same care as the `AuthWrapper.tsx` fix: verify under a real fresh-tab, real-offline-event test (not a possibly-stale cached tab) before considering it resolved — that was the actual pitfall in verifying the sibling bug, not the fix itself.

### Why deferred

Explicitly held back per user direction: infrastructure hardening phase is complete as of the `foundation-phase-complete` tag; this is lower severity than the bug that was fixed (no tab freeze), and further infrastructure work should wait unless something higher-severity surfaces.
