import { createStore } from 'redux';
import Ticks from '../Ticks';
import * as constants from '../state/constants';
import rootReducer from '../state/reducers';
import { watchScope } from '../index';

/**
 * Regression cover for the lifecycle defects behind a bot that bought a real
 * contract and then never moved again: a matched open-contract update that the
 * watcher discarded, and one TradeEngine unsubscribing another's tick monitor.
 */

const duringPurchaseStore = () => {
    const store = createStore(rootReducer);
    store.dispatch({ type: constants.START });
    store.dispatch({ type: constants.PURCHASE_SUCCESSFUL });
    return store;
};

const watchDuring = store =>
    watchScope({
        store,
        stopScope: constants.STOP,
        passScope: constants.DURING_PURCHASE,
        passFlag: 'openContract',
    });

describe('watchScope', () => {
    it('resolves watchDuring on OPEN_CONTRACT without requiring a new tick', async () => {
        const store = duringPurchaseStore();
        expect(store.getState().openContract).toBe(false);

        const watching = watchDuring(store);

        // The only dispatch: no NEW_TICK anywhere. This is the exact sequence
        // OpenContract.js produces for a matched proposal_open_contract, and
        // it used to be discarded because OPEN_CONTRACT leaves newTick alone.
        store.dispatch({ type: constants.OPEN_CONTRACT });

        await expect(watching).resolves.toBe(true);
    });

    it('does not resolve again on the same state without a tick', async () => {
        const store = duringPurchaseStore();
        store.dispatch({ type: constants.OPEN_CONTRACT });

        // Already passing when the watch starts - the loop body has run for
        // this state, so repeating it must wait for a tick rather than spin.
        let resolved = false;
        watchDuring(store).then(() => {
            resolved = true;
        });

        store.dispatch({ type: constants.OPEN_CONTRACT });
        await Promise.resolve();
        expect(resolved).toBe(false);

        store.dispatch({ type: constants.NEW_TICK, payload: 1 });
        await Promise.resolve();
        expect(resolved).toBe(true);
    });

    it('resolves false when the scope moves on, without waiting for a tick', async () => {
        const store = duringPurchaseStore();
        const watching = watchDuring(store);

        store.dispatch({ type: constants.SELL });

        await expect(watching).resolves.toBe(false);
    });

    it('does not share its tick baseline between two engines', async () => {
        // Two engines trading the same symbol see identical tick epochs. With a
        // module-level prevTick, whichever subscriber ran first recorded the
        // epoch and the other then treated its own tick as "not new".
        const store_a = duringPurchaseStore();
        const store_b = duringPurchaseStore();
        store_a.dispatch({ type: constants.OPEN_CONTRACT });
        store_b.dispatch({ type: constants.OPEN_CONTRACT });

        const watching_a = watchDuring(store_a);
        const watching_b = watchDuring(store_b);

        const epoch = 1700000000;
        store_b.dispatch({ type: constants.NEW_TICK, payload: epoch });
        store_a.dispatch({ type: constants.NEW_TICK, payload: epoch });

        await expect(Promise.all([watching_a, watching_b])).resolves.toEqual([true, true]);
    });
});

describe('Ticks.watchTicks', () => {
    const buildEngine = ticks_service => {
        const Engine = Ticks(class {});
        const engine = new Engine();
        engine.$scope = { ticksService: ticks_service };
        engine.store = { dispatch: jest.fn() };
        return engine;
    };

    const fakeTicksService = () => {
        let next_key = 0;
        return {
            stopMonitor: jest.fn().mockResolvedValue(undefined),
            // eslint-disable-next-line no-plusplus
            monitor: jest.fn().mockImplementation(() => Promise.resolve(`key-${++next_key}`)),
        };
    };

    it('does not stop another engine tick monitor', async () => {
        const ticks_service = fakeTicksService();

        const engine_a = buildEngine(ticks_service);
        await engine_a.watchTicks('R_100');
        expect(engine_a.tick_listener_key).toBe('key-1');

        const engine_b = buildEngine(ticks_service);
        await engine_b.watchTicks('R_100');

        // The second engine may only ever stop its own listener, and it has
        // none yet. Passing 'key-1' here is what silently killed the tick feed
        // of a running bot that was holding an open contract.
        expect(ticks_service.stopMonitor).toHaveBeenCalledTimes(2);
        expect(ticks_service.stopMonitor).toHaveBeenLastCalledWith({ symbol: 'R_100', key: undefined });
        expect(engine_b.tick_listener_key).toBe('key-2');
        expect(engine_a.tick_listener_key).toBe('key-1');
    });

    it('still stops its own listener when the same engine switches symbol', async () => {
        const ticks_service = fakeTicksService();
        const engine = buildEngine(ticks_service);

        await engine.watchTicks('R_100');
        await engine.watchTicks('R_50');

        expect(ticks_service.stopMonitor).toHaveBeenLastCalledWith({ symbol: 'R_50', key: 'key-1' });
        expect(engine.tick_listener_key).toBe('key-2');
    });
});
