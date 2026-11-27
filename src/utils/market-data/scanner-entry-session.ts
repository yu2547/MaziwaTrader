import { BehaviorSubject } from 'rxjs';
import { getLastDigit, toDecimalPlaces } from './last-digit';
import { evaluateOverUnder, type TPrediction, type TSide } from './over-under-strategy';
import { public_market_feed, type TTick } from './public-market-feed';

/**
 * Exclusive live-entry gate for an AI Scanner-launched bot.
 * Loading or running a generic Bot Builder strategy never arms this gate.
 *
 * The public feed provides real tick digits and the purchase engine checks
 * consumeEntryPermission() for EVERY purchase, including recovery purchases.
 * A qualifying historical scan alone cannot make a purchase eligible.
 */
export type TScannerSession = {
    active: boolean;
    market: string;
    symbol: string;
    side: TSide;
    prediction: TPrediction;
    status: 'waiting' | 'trigger' | 'confirmed' | 'filters-changed' | 'stopped';
    message: string;
    lastDigit: number | null;
    triggerDigit: number | null;
    confirmationDigit: number | null;
    percentages: number[];
    wins: number;
    maxWins: number;
    netProfit: number;
    stopLoss: number;
    maxStake: number;
    stake: number;
};

const empty: TScannerSession = {
    active: false, market: '', symbol: '', side: 'OVER', prediction: 1,
    status: 'stopped', message: '', lastDigit: null, triggerDigit: null,
    confirmationDigit: null, percentages: [], wins: 0, maxWins: 0,
    netProfit: 0, stopLoss: 0, maxStake: 0, stake: 0,
};
export const scannerSession$ = new BehaviorSubject<TScannerSession>(empty);

type TArmOptions = {
    market: string;
    symbol: string;
    side: TSide;
    prediction: TPrediction;
    digits: number[]; // newest first, verified against Deriv's pip precision
    stake: number;
    maxStake: number;
    stopLoss: number;
    maxWins: number;
};
let controlled = false;
let subscribed: (() => void) | null = null;
let digits: number[] = [];
let historyLimit = 1000;
let lastTickId: string | null = null;
let trigger: number | null = null;
let entryPermission = false;

const publish = (patch: Partial<TScannerSession>) =>
    scannerSession$.next({ ...scannerSession$.getValue(), ...patch });

/** True when a bot is still subject to scanner-only gating. */
export const scannerIsControlling = () => controlled;

/** Release all public-feed resources; other bots remain unaffected. */
export function resetScannerSession() {
    subscribed?.();
    subscribed = null;
    if (controlled) public_market_feed.release();
    controlled = false;
    digits = [];
    lastTickId = null;
    trigger = null;
    entryPermission = false;
    scannerSession$.next(empty);
}

function onTick(tick: TTick) {
    const current = scannerSession$.getValue();
    if (!controlled || !current.active || tick.symbol !== current.symbol) return;
    if (tick.id && tick.id === lastTickId) return;
    lastTickId = tick.id || null;

    const digit = getLastDigit(tick.quote, toDecimalPlaces(tick.pip_size) ?? 2);
    digits = [digit, ...digits].slice(0, historyLimit);
    const match = evaluateOverUnder(digits).find(
        candidate => candidate.side === current.side && candidate.prediction === current.prediction
    );
    // A signal expires on the next tick if it was not consumed. It must never
    // be reused later to open a contract on stale conditions.
    entryPermission = false;
    if (!match?.eligible) {
        trigger = null;
        publish({
            status: 'filters-changed', lastDigit: digit, confirmationDigit: null,
            triggerDigit: null, percentages: match?.percentages ?? [],
            message: 'Live digit frequencies or decreasing trend no longer qualify. Waiting for conditions to recover.',
        });
        return;
    }
    if (current.side === 'UNDER') {
        trigger = null;
        publish({
            lastDigit: digit, percentages: match.percentages, status: 'waiting',
            message: 'Under distribution qualifies; no Under entry-point timing rule has been provided. Live purchases blocked.',
        });
        return;
    }
    // Confirmation is ONLY on the tick immediately following the least
    // frequent of digits 1, 2, 3.
    if (trigger !== null && digit >= 4 && digit <= 9) {
        entryPermission = true;
        publish({
            lastDigit: digit, percentages: match.percentages, status: 'confirmed',
            triggerDigit: trigger, confirmationDigit: digit,
            message: `Over ${current.prediction} live entry: ${trigger} → ${digit}. Bot may purchase once on this tick.`,
        });
        trigger = null;
        return;
    }
    trigger = match.leastTriggerDigits.includes(digit) ? digit : null;
    publish({
        lastDigit: digit, percentages: match.percentages,
        triggerDigit: trigger, confirmationDigit: null,
        status: trigger === null ? 'waiting' : 'trigger',
        message: trigger === null
            ? 'Live filters qualify. Waiting for least-frequent digit 1, 2 or 3.'
            : `Digit ${trigger} detected. The very next tick must be 4–9.`,
    });
}

export function armScannerSession(options: TArmOptions) {
    // Always clear an old scanner session, including subscriptions/signals.
    resetScannerSession();
    if (!Number.isFinite(options.stake) || options.stake <= 0 ||
        !Number.isFinite(options.stopLoss) || options.stopLoss <= 0 ||
        !Number.isFinite(options.maxStake) || options.maxStake < options.stake ||
        !Number.isInteger(options.maxWins) || options.maxWins < 1) {
        throw new Error('Invalid scanner stake, stop-loss, max-stake or win-limit.');
    }
    controlled = true;
    digits = [...options.digits];
    historyLimit = Math.max(100, digits.length);
    scannerSession$.next({
        ...empty,
        active: true,
        market: options.market, symbol: options.symbol,
        side: options.side, prediction: options.prediction,
        stake: options.stake, maxStake: options.maxStake,
        stopLoss: options.stopLoss, maxWins: options.maxWins,
        message: options.side === 'OVER'
            ? 'Scanner bot armed. Waiting for live qualifying ticks; no purchase yet.'
            : 'Under conditions detected, but Under live entry timing is unspecified; purchases disabled.',
        status: 'waiting',
    });
    public_market_feed.acquire();
    subscribed = public_market_feed.subscribeTicks(options.symbol, onTick);
}

/**
 * Returns false for anything not matching the scanner-selected symbol/type,
 * or when the latest live confirmation has expired. The permission is consumed
 * exactly once. Manual bots (no scanner session) use their original behavior.
 */
export function consumeScannerEntryPermission(symbol: string, contractType: string): boolean {
    if (!controlled) return true;
    const state = scannerSession$.getValue();
    const expectedType = state.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
    if (!state.active || state.symbol !== symbol ||
        contractType.toUpperCase() !== expectedType || !entryPermission) {
        return false;
    }
    entryPermission = false;
    publish({ status: 'waiting', message: 'Live entry accepted by the bot; monitoring the contract.' });
    return true;
}

/** Called only on a completed real contract, never an entry attempt. */
export function recordScannerSettlement(profit: number, isWin: boolean): boolean {
    if (!controlled) return false;
    const state = scannerSession$.getValue();
    if (!state.active) return true;
    const wins = state.wins + (isWin ? 1 : 0);
    const netProfit = state.netProfit + profit;
    const hitLimit = wins >= state.maxWins || netProfit <= -state.stopLoss;
    if (hitLimit) {
        entryPermission = false;
        trigger = null;
        publish({
            active: false, wins, netProfit, status: 'stopped',
            message: wins >= state.maxWins
                ? 'Scanner win limit reached; bot stopping.'
                : 'Scanner stop-loss threshold reached; bot stopping.',
        });
    } else {
        publish({
            wins, netProfit,
            message: `Contract settled. Wins: ${wins}/${state.maxWins}; net P/L: ${netProfit.toFixed(2)}.`,
        });
    }
    return hitLimit;
}
