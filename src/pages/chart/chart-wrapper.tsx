import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/hooks/useStore';
import Chart from './chart';
import './chart.scss';

interface ChartWrapperProps {
    prefix?: string;
    show_digits_stats: boolean;
}

const ChartWrapper = observer(({ prefix = 'chart', show_digits_stats }: ChartWrapperProps) => {
    // RootStore is built in StoreProvider's own effect, so useStore() is null
    // on the first render. Destructuring it outright threw "Cannot destructure
    // property 'client'" and took the whole page down with it - reachable by
    // loading a route that mounts a chart directly rather than arriving at it
    // from an already-running app.
    const store = useStore();
    const [uuid] = useState(uuidv4());

    // Chart itself reads chart_store, run_panel and dashboard straight off the
    // store, so it must not mount until there is one - it renders on the next
    // pass, a frame later, rather than not at all.
    if (!store) return null;

    const uniqueKey = store.client?.loginid ? `${prefix}-${store.client.loginid}` : `${prefix}-${uuid}`;

    return <Chart key={uniqueKey} show_digits_stats={show_digits_stats} />;
});

export default ChartWrapper;
