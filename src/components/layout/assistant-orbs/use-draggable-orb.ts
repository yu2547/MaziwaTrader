import React, { useEffect, useRef, useState } from 'react';

/**
 * The press-to-open, drag-to-move behaviour both floating orbs share.
 *
 * Lifted out of execution-bar/index.tsx when a second orb needed it. One
 * implementation rather than two: the clamping, the drag threshold and the
 * keyboard path are the parts that were expensive to get right, and a copy of
 * them would drift.
 */

// Must track the orb's rendered width (7.2rem in execution-bar.scss at the
// app's 10px root). It was 64 while the orb drew at 84, so every clamp allowed
// it 20px past the right and bottom edges - the corner it is most often
// dragged to, and the one where it then sat half off a narrow phone.
const ORB_SIZE = 72;
const ORB_MARGIN = 8;

/** Past this much movement a press is a drag, not a click. */
const DRAG_SLOP = 4;

export type TPoint = { x: number; y: number };

const readStoredPosition = (key: string): TPoint | null => {
    try {
        const raw = sessionStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        return typeof parsed?.x === 'number' && typeof parsed?.y === 'number' ? parsed : null;
    } catch {
        return null;
    }
};

const clampToViewport = ({ x, y }: TPoint): TPoint => ({
    x: Math.min(Math.max(x, ORB_MARGIN), window.innerWidth - ORB_SIZE - ORB_MARGIN),
    y: Math.min(Math.max(y, ORB_MARGIN), window.innerHeight - ORB_SIZE - ORB_MARGIN),
});

const useDraggableOrb = ({ onActivate, storage_key }: { onActivate: () => void; storage_key: string }) => {
    // Where the user last put the orb. Null means "wherever the stylesheet
    // parks it", so an untouched orb keeps its default corner.
    // Clamped on the way in, not just on resize: the stored point was written
    // against whatever viewport the user last dragged it on, so restoring it on
    // a narrower phone - or in portrait after landscape - put the orb partly or
    // wholly off-screen, and the resize listener below only fires if the window
    // then changes again.
    const [position, setPosition] = useState<TPoint | null>(() => {
        const stored = readStoredPosition(storage_key);
        return stored ? clampToViewport(stored) : null;
    });
    const [is_dragging, setIsDragging] = useState(false);
    // A callback ref rather than useRef: the orb does not render on the first
    // pass, so an effect keyed on [] measured a ref that was still null and
    // never ran again once it appeared. This re-runs whenever the node mounts.
    const [element, setElement] = useState<HTMLButtonElement | null>(null);
    const drag = useRef({ active: false, moved: false, dx: 0, dy: 0 });

    // A window that shrank past the orb would otherwise strand it off-screen.
    useEffect(() => {
        if (!position) return undefined;
        const onResize = () => setPosition(current => (current ? clampToViewport(current) : current));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [position]);

    // The orb opens from pointerup, so that a press which moved counts as a
    // drag rather than a click. Keyboard activation fires no pointer events at
    // all - Enter and Space on a <button> raise only `click` - so that path
    // left the orb focusable, labelled, and completely inert: tab to it, press
    // Enter, nothing happens.
    //
    // Handled here rather than by adding onClick, because a click also arrives
    // at the end of a real drag, and opening the panel every time the user
    // finished repositioning the orb is the bug the pointerup logic exists to
    // avoid. preventDefault stops the browser's synthetic click on top of this.
    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onActivate();
    };

    const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        drag.current = { active: true, moved: false, dx: event.clientX - box.left, dy: event.clientY - box.top };
        // Capture keeps the drag alive if the pointer outruns the orb, but it
        // throws for a pointer the browser is not tracking. Losing capture
        // only costs a rougher drag; letting it throw here would abort the
        // handler and leave the orb unable to open at all.
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Drag still works, it just stops if the pointer leaves the orb.
        }
    };

    const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!drag.current.active) return;
        const next = clampToViewport({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy });
        const box = event.currentTarget.getBoundingClientRect();
        if (Math.abs(next.x - box.left) > DRAG_SLOP || Math.abs(next.y - box.top) > DRAG_SLOP) {
            drag.current.moved = true;
            setIsDragging(true);
        }
        if (drag.current.moved) setPosition(next);
    };

    const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!drag.current.active) return;
        drag.current.active = false;
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // Nothing to release - not a reason to skip the activation below.
        }
        setIsDragging(false);
        // A press that never moved is a click - open the panel. A press that
        // moved was a drag, and should not also open it.
        if (!drag.current.moved) {
            onActivate();
            return;
        }
        setPosition(current => {
            if (current) sessionStorage.setItem(storage_key, JSON.stringify(current));
            return current;
        });
    };

    return {
        element,
        handlers: {
            onKeyDown,
            onPointerCancel: onPointerUp,
            onPointerDown,
            onPointerMove,
            onPointerUp,
            ref: setElement,
        },
        is_dragging,
        position,
        /** Inline offsets once the orb has been moved, and nothing before that. */
        style: position
            ? { bottom: 'auto', left: position.x, right: 'auto', top: position.y }
            : (undefined as React.CSSProperties | undefined),
    };
};

export default useDraggableOrb;
