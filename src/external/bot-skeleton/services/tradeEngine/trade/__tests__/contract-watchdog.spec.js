import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import { api_base } from '../../../api/api-base';
import OpenContract from '../OpenContract';
import * as constants from '../state/constants';
import rootReducer from '../state/reducers';

/**
 * Regression cover for a bot that bought a contract, saw Deriv settle it - the
 * balance moved - and then sat on "Contract bought" for good, because not one
 * update for that contract ever reached the engine. Recorded on a phone: three
 * runs in a row, each frozen the same way.
 *
 * Each case pins a decision: when the engine asks Deriv directly, that it
 * stays quiet while the stream works, that it settles the run on Deriv's own
 * answer, and that neither a silent socket nor a stopped run leaves it stuck.
 */

jest.mock('../../../api/api-base', () => ({
    api_base: {
        api: null,
        account_info: { account_id: 'CR123' },
        pushSubscription: jest.fn(),
    },
}));

const CONTRACT_ID = 128233392939;

const open = (overrides = {}) => ({
    contract_id: CONTRACT_ID,
    is_sold: 0,
    transaction_ids: { buy: 1 },
    ...overrides,
});

const sold = (overrides = {}) =>
    open({ is_sold: 1, profit: 1.69, status: 'won', transaction_ids: { buy: 1, sell: 2 }, ...overrides });

/** An engine holding one bought contract, exactly as Purchase.js leaves it. */
const boughtEngine = () => {
    const Engine = OpenContract(class {});
    const engine = new Engine();
    // Built the way TradeEngine builds it (trade/index.js): the engine's
    // actions are thunks.
    engine.store = createStore(rootReducer, applyMiddleware(thunk));
    engine.store.dispatch({ type: constants.START });
    engine.store.dispatch({ type: constants.PURCHASE_SUCCESSFUL });
    engine.data = { contract: {} };
    engine.updateTotals = jest.fn();
    engine.contractId = CONTRACT_ID;
    return engine;
};

/** Lets the promise chains queued by a timer run to the end. */
const settle = async () => {
    for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

describe('contract watchdog', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        api_base.pushSubscription.mockClear();
        api_base.api = { send: jest.fn() };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('asks Deriv for the contract after six silent seconds, and settles the run on the answer', async () => {
        const engine = boughtEngine();
        api_base.api.send.mockResolvedValue({ proposal_open_contract: sold() });

        engine.startContractWatchdog();

        jest.advanceTimersByTime(5999);
        expect(api_base.api.send).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(api_base.api.send).toHaveBeenCalledWith({ proposal_open_contract: 1, contract_id: CONTRACT_ID });

        await settle();
        // The run moves on: scope leaves DURING_PURCHASE, the contract is
        // released, and the totals are counted from Deriv's own result.
        expect(engine.store.getState().scope).toBe(constants.STOP);
        expect(engine.contractId).toBe('');
        expect(engine.updateTotals).toHaveBeenCalledWith(expect.objectContaining({ profit: 1.69 }));
    });

    it('sends nothing while the stream keeps delivering updates', async () => {
        const engine = boughtEngine();
        engine.startContractWatchdog();

        // An update every three seconds for thirty seconds - a healthy stream.
        for (let second = 0; second < 30; second += 3) {
            jest.advanceTimersByTime(3000);
            engine.onOpenContract(open());
        }
        await settle();

        expect(api_base.api.send).not.toHaveBeenCalled();
    });

    it('keeps asking while the contract is still open, and stops once it settles', async () => {
        const engine = boughtEngine();
        api_base.api.send
            .mockResolvedValueOnce({ proposal_open_contract: open() })
            .mockResolvedValueOnce({ proposal_open_contract: sold() });

        engine.startContractWatchdog();

        jest.advanceTimersByTime(6000);
        await settle();
        expect(api_base.api.send).toHaveBeenCalledTimes(1);
        expect(engine.contractId).toBe(CONTRACT_ID);

        jest.advanceTimersByTime(6000);
        await settle();
        expect(api_base.api.send).toHaveBeenCalledTimes(2);
        expect(engine.contractId).toBe('');

        // Settled: nothing further is asked.
        jest.advanceTimersByTime(60000);
        await settle();
        expect(api_base.api.send).toHaveBeenCalledTimes(2);
    });

    it('is not stalled by a request the socket never answers', async () => {
        // @deriv/deriv-api never settles a request whose socket died under it.
        // Waiting on that one is how the bot hung in the first place.
        const engine = boughtEngine();
        api_base.api.send
            .mockReturnValueOnce(new Promise(() => {}))
            .mockResolvedValueOnce({ proposal_open_contract: sold() });

        engine.startContractWatchdog();

        jest.advanceTimersByTime(6000);
        expect(api_base.api.send).toHaveBeenCalledTimes(1);

        // The first request times out after eight seconds, and the next check
        // follows six after that.
        jest.advanceTimersByTime(8000);
        await settle();
        jest.advanceTimersByTime(6000);
        await settle();

        expect(api_base.api.send).toHaveBeenCalledTimes(2);
        expect(engine.contractId).toBe('');
    });

    it('asks on whichever socket is live at the time', async () => {
        // A socket replaced mid-contract is the usual reason the stream went
        // quiet, so the request must not be pinned to the socket that bought.
        const engine = boughtEngine();
        const replacement = { send: jest.fn().mockResolvedValue({ proposal_open_contract: sold() }) };

        engine.startContractWatchdog();
        api_base.api = replacement;

        jest.advanceTimersByTime(6000);
        await settle();

        expect(replacement.send).toHaveBeenCalledTimes(1);
        expect(engine.contractId).toBe('');
    });

    it('stops when the run is stopped', async () => {
        const engine = boughtEngine();
        engine.startContractWatchdog();

        // Stopping the bot clears api_base's subscriptions; the watchdog is
        // registered among them so it goes with them.
        const [[registration]] = api_base.pushSubscription.mock.calls;
        registration.unsubscribe();

        jest.advanceTimersByTime(60000);
        await settle();
        expect(api_base.api.send).not.toHaveBeenCalled();
    });

    it('does not start again when a request in flight at the stop comes back', async () => {
        const engine = boughtEngine();
        let answer = () => {};
        api_base.api.send.mockReturnValueOnce(
            new Promise(resolve => {
                answer = resolve;
            })
        );

        engine.startContractWatchdog();
        jest.advanceTimersByTime(6000);
        expect(api_base.api.send).toHaveBeenCalledTimes(1);

        // Stopped while that request is out.
        const [[registration]] = api_base.pushSubscription.mock.calls;
        registration.unsubscribe();

        // It comes back still open - and nothing is asked after it.
        answer({ proposal_open_contract: open() });
        await settle();
        jest.advanceTimersByTime(60000);
        await settle();
        expect(api_base.api.send).toHaveBeenCalledTimes(1);
    });

    it('registers with the run once, however many contracts it watches', () => {
        const engine = boughtEngine();
        engine.startContractWatchdog();
        engine.contractId = CONTRACT_ID + 1;
        engine.startContractWatchdog();
        expect(api_base.pushSubscription).toHaveBeenCalledTimes(1);
    });

    it('ignores the second copy of an update it has already settled on', async () => {
        // A direct request's answer also arrives on the socket's message stream.
        const engine = boughtEngine();
        engine.onOpenContract(sold());
        engine.onOpenContract(sold());
        expect(engine.updateTotals).toHaveBeenCalledTimes(1);
    });
});

describe('expectedContractId', () => {
    it('matches the same contract whether its id arrives as a number or as text', () => {
        const engine = boughtEngine();
        engine.contractId = CONTRACT_ID;
        expect(engine.expectedContractId(String(CONTRACT_ID))).toBe(true);

        engine.contractId = String(CONTRACT_ID);
        expect(engine.expectedContractId(CONTRACT_ID)).toBe(true);
    });

    it('matches nothing when no contract is held', () => {
        const engine = boughtEngine();
        engine.contractId = '';
        expect(engine.expectedContractId(CONTRACT_ID)).toBe(false);
        expect(engine.expectedContractId(undefined)).toBe(false);
    });
});
