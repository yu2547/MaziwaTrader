import SubscriptionManager from '../subscription-manager';

/**
 * Regression cover for the restore that could never finish.
 *
 * @deriv/deriv-api never settles a request whose socket closes under it. When
 * a phone dropped its connection while a restore was waiting on one, the
 * restore stayed "in progress" for the rest of the page's life, every later
 * reconnect skipped restoring, and the live socket never carried contract
 * updates again - the bot bought and never heard the result.
 */

jest.mock('../ws-logger', () => ({ wsLog: jest.fn() }));

const STREAMS: Array<[string, Record<string, unknown>]> = [
    ['balance', { balance: 1, subscribe: 1 }],
    ['transaction', { transaction: 1, subscribe: 1 }],
    ['proposal_open_contract', { proposal_open_contract: 1, subscribe: 1 }],
];

/** Answers every request with a subscription id derived from its stream and a tag. */
const answer = (tag: string) => (request: Record<string, unknown>) =>
    Promise.resolve({ subscription: { id: `${Object.keys(request)[0]}-${tag}` } });

const registered = async (send: jest.Mock) => {
    const manager = new SubscriptionManager(send);
    send.mockImplementation(answer('first'));
    // eslint-disable-next-line no-restricted-syntax
    for (const [key, request] of STREAMS) {
        // eslint-disable-next-line no-await-in-loop
        await manager.subscribe(key, request);
    }
    send.mockReset();
    manager.markAllInactive();
    return manager;
};

const flush = async () => {
    for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

describe('SubscriptionManager.restoreAll', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('finishes even when a request is never answered', async () => {
        const send = jest.fn();
        const manager = await registered(send);
        const socket = {};

        send.mockReturnValueOnce(new Promise(() => {})).mockImplementation(answer('live'));

        let finished = false;
        manager.restoreAll(socket).then(() => {
            finished = true;
        });

        await flush();
        expect(finished).toBe(false);

        jest.advanceTimersByTime(10000);
        await flush();

        expect(finished).toBe(true);
        // The two that were answered are live; the one that was not is left
        // without an id, which is the truth about it.
        expect(manager.getActiveSubscriptionIds()).toEqual(['transaction-live', 'proposal_open_contract-live']);
    });

    it('restores onto a new socket while a restore for a dead one is still waiting', async () => {
        const send = jest.fn();
        const manager = await registered(send);
        const dead_socket = {};
        const new_socket = {};

        // The dead socket's first request never comes back.
        send.mockReturnValueOnce(new Promise(() => {}));
        manager.restoreAll(dead_socket);
        await flush();

        // A reconnect: every stream must be sent again for the new socket.
        send.mockImplementation(answer('new'));
        await manager.restoreAll(new_socket);

        expect(manager.getActiveSubscriptionIds()).toEqual([
            'balance-new',
            'transaction-new',
            'proposal_open_contract-new',
        ]);
    });

    it('does not let the superseded restore overwrite the new ids when it finally moves', async () => {
        const send = jest.fn();
        const manager = await registered(send);

        let answerDeadSocket: (value: unknown) => void = () => {};
        send.mockReturnValueOnce(
            new Promise(resolve => {
                answerDeadSocket = resolve;
            })
        );
        manager.restoreAll({});
        await flush();

        send.mockImplementation(answer('new'));
        await manager.restoreAll({});

        // The dead socket's reply turns up late.
        answerDeadSocket({ subscription: { id: 'balance-dead' } });
        await flush();

        expect(manager.getActiveSubscriptionIds()).toEqual([
            'balance-new',
            'transaction-new',
            'proposal_open_contract-new',
        ]);
    });

    it('skips a second signal for the same socket', async () => {
        const send = jest.fn();
        const manager = await registered(send);
        const socket = {};

        send.mockImplementation(answer('live'));
        const first = manager.restoreAll(socket);
        const second = manager.restoreAll(socket);
        await Promise.all([first, second]);

        expect(send).toHaveBeenCalledTimes(STREAMS.length);
    });

    it('restores again after a finished restore, for the next reconnect', async () => {
        const send = jest.fn();
        const manager = await registered(send);
        const socket = {};

        send.mockImplementation(answer('one'));
        await manager.restoreAll(socket);
        manager.markAllInactive();

        send.mockImplementation(answer('two'));
        await manager.restoreAll(socket);

        expect(manager.getActiveSubscriptionIds()).toEqual([
            'balance-two',
            'transaction-two',
            'proposal_open_contract-two',
        ]);
    });
});

describe('SubscriptionManager.subscribe', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('gives up on a first subscribe that is never answered, rather than hanging the connect', async () => {
        const send = jest.fn().mockReturnValue(new Promise(() => {}));
        const manager = new SubscriptionManager(send);

        let finished = false;
        manager.subscribe('proposal_open_contract', { proposal_open_contract: 1, subscribe: 1 }).then(() => {
            finished = true;
        });

        jest.advanceTimersByTime(10000);
        await flush();

        expect(finished).toBe(true);
        expect(manager.getActiveSubscriptionIds()).toEqual([]);
    });

    it('treats a refused subscribe as not subscribed, without throwing', async () => {
        const send = jest.fn().mockRejectedValue({ error: { code: 'AlreadySubscribed' } });
        const manager = new SubscriptionManager(send);

        await expect(manager.subscribe('balance', { balance: 1, subscribe: 1 })).resolves.toEqual(
            expect.objectContaining({ key: 'balance', subscription_id: null })
        );
    });
});
