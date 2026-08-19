/**
 * Virtual Hook settings.
 *
 * The hook makes the bot trade on paper first - watching real ticks and
 * scoring the result without sending a `buy` - and only commit real money once
 * the configured number of virtual losses has occurred. After a set number of
 * real wins it goes back to watching. It is a risk filter, not a simulator:
 * nothing it does is ever written to Transactions, Summary or the balance.
 *
 * Where each setting lives matters:
 *
 * - The three numeric settings belong to the strategy, so they are stored on
 *   the block and travel with the bot's XML like any other parameter.
 *
 * - The token does NOT. It is a Deriv API token, and bot XML is exported,
 *   shared and published - the Free Bots on this site are downloadable. A
 *   token written into a strategy file is account access handed to whoever
 *   opens it. It is kept in sessionStorage instead: per browser, per session,
 *   never serialised into the bot and gone when the tab closes.
 */
const VH_TOKEN_KEY = 'mw_vh_token';

export type TVirtualHookSettings = {
    enabled: boolean;
    max_virtual_loss_steps: number;
    required_real_wins: number;
    virtual_stake: number;
};

export const VIRTUAL_HOOK_DEFAULTS: TVirtualHookSettings = {
    enabled: false,
    max_virtual_loss_steps: 1,
    required_real_wins: 1,
    virtual_stake: 0.35,
};

/** Kept out of the strategy file - see the note above. */
export const getVirtualHookToken = (): string => {
    try {
        return sessionStorage.getItem(VH_TOKEN_KEY) ?? '';
    } catch {
        return '';
    }
};

export const setVirtualHookToken = (token: string): void => {
    try {
        if (token) sessionStorage.setItem(VH_TOKEN_KEY, token);
        else sessionStorage.removeItem(VH_TOKEN_KEY);
    } catch {
        // Storage unavailable (private mode). The hook still works; the token
        // simply is not remembered between reloads.
    }
};

const clampInt = (value: unknown, min: number, fallback: number): number => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

const clampFloat = (value: unknown, min: number, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

/**
 * Reads the numeric settings off a Blockly block. They are held in block.data
 * as JSON, which Blockly serialises into the XML automatically, so they
 * survive save/load/export without needing visible fields cluttering the
 * block face.
 */
export const readVirtualHookSettings = (block: { data?: string | null } | null): TVirtualHookSettings => {
    if (!block?.data) return { ...VIRTUAL_HOOK_DEFAULTS };
    try {
        const parsed = JSON.parse(block.data) as Partial<TVirtualHookSettings> & { vh?: Partial<TVirtualHookSettings> };
        const source = parsed.vh ?? parsed;
        return {
            enabled: Boolean(source.enabled),
            max_virtual_loss_steps: clampInt(source.max_virtual_loss_steps, 1, 1),
            required_real_wins: clampInt(source.required_real_wins, 1, 1),
            virtual_stake: clampFloat(source.virtual_stake, 0, VIRTUAL_HOOK_DEFAULTS.virtual_stake),
        };
    } catch {
        return { ...VIRTUAL_HOOK_DEFAULTS };
    }
};

export const writeVirtualHookSettings = (
    block: { data?: string | null } | null,
    settings: TVirtualHookSettings
): void => {
    if (!block) return;
    // Merged into whatever else may already live in block.data rather than
    // overwriting it, so this cannot clobber another feature's state.
    let existing: Record<string, unknown> = {};
    try {
        existing = block.data ? (JSON.parse(block.data) as Record<string, unknown>) : {};
    } catch {
        existing = {};
    }
    block.data = JSON.stringify({ ...existing, vh: settings });
};

/** Event the block fires to ask the React layer to open the settings dialog. */
export const VH_SETTINGS_EVENT = 'mw:open-vh-settings';
