import Observer from '../observer';

describe('Observer.unregister', () => {
    it('removes only the handler it was given', () => {
        const observer = new Observer();
        const kept = jest.fn();
        const removed = jest.fn();

        observer.register('bot.contract', kept);
        observer.register('bot.contract', removed);
        observer.unregister('bot.contract', removed);
        observer.emit('bot.contract', { id: 1 });

        expect(kept).toHaveBeenCalledWith({ id: 1 });
        expect(removed).not.toHaveBeenCalled();
    });

    /**
     * The crash this guards against: unregisterAll() deletes the event key, so
     * a later unregister() filtered undefined and threw "Cannot read properties
     * of undefined (reading 'filter')". Any component holding a handler for an
     * event somebody else had cleared took its whole route down on cleanup -
     * the run panel clears 'bot.contract' whenever a page using it unmounts.
     */
    it('does not throw when the event was already cleared', () => {
        const observer = new Observer();
        const handler = jest.fn();

        observer.register('bot.contract', handler);
        observer.unregisterAll('bot.contract');

        expect(() => observer.unregister('bot.contract', handler)).not.toThrow();
    });

    it('does not throw for an event that never had a handler', () => {
        const observer = new Observer();

        expect(() => observer.unregister('never.registered', () => {})).not.toThrow();
    });

    it('leaves a cleared event still usable afterwards', () => {
        const observer = new Observer();
        const handler = jest.fn();

        observer.register('bot.contract', handler);
        observer.unregisterAll('bot.contract');
        observer.unregister('bot.contract', handler);

        const fresh = jest.fn();
        observer.register('bot.contract', fresh);
        observer.emit('bot.contract', { id: 2 });

        expect(fresh).toHaveBeenCalledWith({ id: 2 });
        expect(handler).not.toHaveBeenCalled();
    });
});
