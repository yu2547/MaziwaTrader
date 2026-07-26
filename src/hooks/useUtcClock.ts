import { useEffect, useState } from 'react';

type TTickListener = (now: Date) => void;

const listeners = new Set<TTickListener>();
let interval_id: ReturnType<typeof setInterval> | null = null;

const tick = () => {
    const now = new Date();
    listeners.forEach(listener => listener(now));
};

/** Single shared 1-second UTC ticker - any number of components can subscribe without adding extra timers. */
const useUtcClock = () => {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        listeners.add(setNow);
        if (!interval_id) {
            interval_id = setInterval(tick, 1000);
        }
        return () => {
            listeners.delete(setNow);
            if (listeners.size === 0 && interval_id) {
                clearInterval(interval_id);
                interval_id = null;
            }
        };
    }, []);

    return now;
};

export default useUtcClock;
