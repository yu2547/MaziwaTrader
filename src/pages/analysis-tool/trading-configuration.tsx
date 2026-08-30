import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { DBOT_TABS } from '@/constants/bot-contents';
import { ApiHelpers, config as bot_config } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { useTranslations } from '@deriv-com/translations';

/**
 * The trade settings behind the Run button, as a dialog on the analysis page.
 *
 * This is a front end, not a second engine. Every option in it comes from the
 * same ApiHelpers the Bot Builder's Quick Strategy reads, and Run hands the
 * finished configuration to quick_strategy.onSubmit - the one path in this app
 * that builds a strategy and starts it. Nothing here talks to the trading API,
 * decides a contract, or places an order.
 *
 * It has to hand off rather than run in place: onSubmit loads blocks into
 * Blockly.derivWorkspace, and that workspace only exists once the Bot Builder
 * has mounted. So Run opens the Bot Builder and submits there, which is also
 * where the run panel and the transactions appear.
 */

type TOption = { text: string; value: string };
type TTradeTypeOption = TOption & { group?: string };
type TDurationOption = { display: string; unit: string; min: number; max: number };
/** What active_symbols.getAllSymbols() actually returns - flattened market ->
 *  submarket -> symbol rows, each carrying its own display name. */
type TApiSymbol = { symbol: string; symbol_display: string; market_display: string };

type TContractsFor = {
    getTradeTypesForQuickStrategy: (symbol: string) => Promise<TTradeTypeOption[]>;
    getContractTypes: (trade_type: string) => TOption[];
    getDurations: (symbol: string, trade_type: string) => Promise<TDurationOption[]>;
};

type TApiHelpers = {
    contracts_for?: TContractsFor;
    active_symbols?: { getAllSymbols: (should_be_open?: boolean) => TApiSymbol[] };
};

/** The market list the analysis page already holds, used when the bot API has none. */
type TFeedSymbol = { underlying_symbol: string; underlying_symbol_name: string; market: string };

type TProps = {
    default_symbol: string;
    feed_symbols: TFeedSymbol[];
    onClose: () => void;
};

const WORKSPACE_TIMEOUT = 15000;

/** synthetic_index -> Synthetic Index. Only reached when the bot API, which
 *  carries the proper display names, has not answered. */
const humanize = (code: string) =>
    String(code ?? '')
        .split('_')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

/** The Bot Builder's workspace. Blockly's own types do not declare the field
 *  this app hangs it on, so it is read through a narrow shape rather than by
 *  widening the global. */
const getWorkspace = () => (window as unknown as { Blockly?: { derivWorkspace?: unknown } }).Blockly?.derivWorkspace;

/** Resolves once the Bot Builder has built its workspace, or false on timeout. */
const waitForWorkspace = (timeout_ms: number) =>
    new Promise<boolean>(resolve => {
        const started = Date.now();
        const check = () => {
            if (getWorkspace()) {
                resolve(true);
            } else if (Date.now() - started > timeout_ms) {
                resolve(false);
            } else {
                window.setTimeout(check, 120);
            }
        };
        check();
    });

const TradingConfiguration = observer(({ default_symbol, feed_symbols, onClose }: TProps) => {
    const { client, dashboard, quick_strategy } = useStore() ?? {};
    const { localize } = useTranslations();
    const navigate = useNavigate();

    const dialog_ref = useRef<HTMLDivElement>(null);
    const opener_ref = useRef<Element | null>(null);

    const [symbols, setSymbols] = useState<TApiSymbol[]>([]);
    const [trade_types, setTradeTypes] = useState<TTradeTypeOption[]>([]);
    const [contract_types, setContractTypes] = useState<TOption[]>([]);
    const [durations, setDurations] = useState<TDurationOption[]>([]);
    const [status, setStatus] = useState<'idle' | 'starting' | 'error'>('idle');
    const [is_loading_types, setIsLoadingTypes] = useState(true);

    const [symbol, setSymbol] = useState(default_symbol);
    const [tradetype, setTradeType] = useState('');
    const [type, setType] = useState('');
    const [prediction, setPrediction] = useState(0);
    const [duration, setDuration] = useState(1);
    const [durationtype, setDurationType] = useState('t');
    const [stake, setStake] = useState(1);
    const [candleinterval, setCandleInterval] = useState('60');

    const helpers = (ApiHelpers?.instance ?? {}) as TApiHelpers;
    const currency = client?.currency || 'USD';

    // Escape closes, focus starts inside and goes back to the button after.
    useEffect(() => {
        opener_ref.current = document.activeElement;
        dialog_ref.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            (opener_ref.current as HTMLElement | null)?.focus?.();
        };
    }, [onClose]);

    // The markets the bot can actually trade, with the names the rest of the
    // app uses for them.
    useEffect(() => {
        const list = helpers.active_symbols?.getAllSymbols?.(true) ?? [];
        setSymbols(list);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Trade types follow the market: a symbol that cannot be traded as digits
    // must not offer Even/Odd.
    useEffect(() => {
        let is_current = true;
        setIsLoadingTypes(true);
        const request = helpers.contracts_for?.getTradeTypesForQuickStrategy?.(symbol);
        if (!request) {
            setIsLoadingTypes(false);
            setTradeTypes([]);
            return undefined;
        }
        request
            .then(list => {
                if (!is_current) return;
                setTradeTypes(list ?? []);
                const still_valid = (list ?? []).some(item => item.value === tradetype);
                if (!still_valid) setTradeType(list?.[0]?.value ?? '');
            })
            .catch(() => {
                if (is_current) setTradeTypes([]);
            })
            .finally(() => {
                if (is_current) setIsLoadingTypes(false);
            });
        return () => {
            is_current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol]);

    // Contracts and durations follow the trade type.
    useEffect(() => {
        if (!tradetype) return undefined;
        let is_current = true;

        const contracts = helpers.contracts_for?.getContractTypes?.(tradetype) ?? [];
        setContractTypes(contracts);
        if (!contracts.some(item => item.value === type)) setType(contracts[0]?.value ?? '');

        helpers.contracts_for
            ?.getDurations?.(symbol, tradetype)
            .then(list => {
                if (!is_current) return;
                setDurations(list ?? []);
                const current = (list ?? []).find(item => item.unit === durationtype) ?? list?.[0];
                if (current) {
                    setDurationType(current.unit);
                    setDuration(prev => Math.min(current.max, Math.max(current.min, prev)));
                }
            })
            .catch(() => {
                if (is_current) setDurations([]);
            });

        return () => {
            is_current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, tradetype]);

    // The bot API knows the proper market names, so it wins when it has
    // answered. The analysis page's own list is what keeps the selector usable
    // when it has not.
    const symbol_options = useMemo(() => {
        if (symbols.length) {
            return symbols.map(item => ({
                value: item.symbol,
                text: item.symbol_display,
                market: item.market_display,
            }));
        }
        return feed_symbols.map(item => ({
            value: item.underlying_symbol,
            text: item.underlying_symbol_name,
            market: humanize(item.market),
        }));
    }, [symbols, feed_symbols]);

    const selected_symbol = symbol_options.find(item => item.value === symbol);
    const selected_trade_type = trade_types.find(item => item.value === tradetype);
    const selected_duration = durations.find(item => item.unit === durationtype);
    const has_no_trade_types = !is_loading_types && trade_types.length === 0;

    const candle_intervals = useMemo(() => {
        const intervals = (bot_config?.()?.candleIntervals ?? []) as [string, string][];
        return intervals.filter(([, value]) => value !== 'default');
    }, []);

    const is_ready = Boolean(symbol && tradetype && type);

    const onRun = useCallback(async () => {
        if (!is_ready || !quick_strategy) return;
        setStatus('starting');

        const values = {
            symbol,
            tradetype,
            type,
            duration,
            durationtype,
            stake,
            last_digit_prediction: prediction,
            candleinterval,
        };
        Object.entries(values).forEach(([key, value]) => quick_strategy.setValue(key, value));

        // The workspace lives in the Bot Builder, so the run happens there.
        navigate('/');
        dashboard?.setActiveTab(DBOT_TABS.BOT_BUILDER);

        const has_workspace = await waitForWorkspace(WORKSPACE_TIMEOUT);
        if (!has_workspace) {
            setStatus('error');
            return;
        }

        await quick_strategy.onSubmit({ ...values, action: 'RUN' });
        onClose();
    }, [
        is_ready,
        quick_strategy,
        symbol,
        tradetype,
        type,
        duration,
        durationtype,
        stake,
        prediction,
        candleinterval,
        navigate,
        dashboard,
        onClose,
    ]);

    return createPortal(
        <div className='mw-tc' role='presentation' onClick={onClose}>
            <div
                className='mw-tc__dialog'
                role='dialog'
                aria-modal='true'
                aria-labelledby='mw-tc-title'
                tabIndex={-1}
                ref={dialog_ref}
                onClick={event => event.stopPropagation()}
            >
                <div className='mw-tc__head'>
                    <h2 className='mw-tc__title' id='mw-tc-title'>
                        {localize('Trading Configuration')}
                    </h2>
                    <button type='button' className='mw-tc__close' onClick={onClose} aria-label={localize('Close')}>
                        ×
                    </button>
                </div>

                <div className='mw-tc__grid'>
                    <label className='mw-tc__field'>
                        <span className='mw-tc__label'>{localize('Volatility:')}</span>
                        <select value={symbol} onChange={event => setSymbol(event.target.value)}>
                            {symbol_options.length === 0 && <option value={symbol}>{symbol}</option>}
                            {symbol_options.map(item => (
                                <option key={item.value} value={item.value}>
                                    {item.text}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className='mw-tc__field'>
                        <span className='mw-tc__label'>{localize('Market:')}</span>
                        <output className='mw-tc__readout'>{selected_symbol?.market ?? '—'}</output>
                    </div>

                    <div className='mw-tc__field'>
                        <span className='mw-tc__label'>{localize('Trade Type:')}</span>
                        <output className='mw-tc__readout'>{selected_trade_type?.group ?? '—'}</output>
                    </div>

                    <label className='mw-tc__field'>
                        <span className='mw-tc__label'>{localize('Type:')}</span>
                        <select value={tradetype} onChange={event => setTradeType(event.target.value)}>
                            {trade_types.length === 0 && (
                                <option value=''>
                                    {is_loading_types ? localize('Loading…') : localize('Not available')}
                                </option>
                            )}
                            {trade_types.map(item => (
                                <option key={item.value} value={item.value}>
                                    {item.text}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className='mw-tc__field'>
                        <span className='mw-tc__label'>{localize('Contract:')}</span>
                        <select value={type} onChange={event => setType(event.target.value)}>
                            {contract_types.length === 0 && (
                                <option value=''>
                                    {is_loading_types ? localize('Loading…') : localize('Not available')}
                                </option>
                            )}
                            {contract_types.map(item => (
                                <option key={item.value} value={item.value}>
                                    {item.text}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className='mw-tc__field'>
                        <span className='mw-tc__label'>{localize('Prediction:')}</span>
                        <input
                            type='number'
                            min={0}
                            max={9}
                            step={1}
                            value={prediction}
                            onChange={event => setPrediction(Math.min(9, Math.max(0, Number(event.target.value) || 0)))}
                        />
                    </label>

                    <label className='mw-tc__field'>
                        <span className='mw-tc__label'>{localize('Duration:')}</span>
                        <span className='mw-tc__pair'>
                            <input
                                type='number'
                                min={selected_duration?.min ?? 1}
                                max={selected_duration?.max ?? 10}
                                step={1}
                                value={duration}
                                onChange={event => setDuration(Number(event.target.value) || 0)}
                            />
                            <select value={durationtype} onChange={event => setDurationType(event.target.value)}>
                                {durations.length === 0 && <option value={durationtype}>{localize('Ticks')}</option>}
                                {durations.map(item => (
                                    <option key={item.unit} value={item.unit}>
                                        {item.display}
                                    </option>
                                ))}
                            </select>
                        </span>
                    </label>

                    <label className='mw-tc__field'>
                        <span className='mw-tc__label'>{localize('Stake:')}</span>
                        <span className='mw-tc__pair'>
                            <input
                                type='number'
                                min={0}
                                step={0.5}
                                value={stake}
                                onChange={event => setStake(Number(event.target.value) || 0)}
                            />
                            <output className='mw-tc__unit'>{currency}</output>
                        </span>
                    </label>

                    <label className='mw-tc__field'>
                        <span className='mw-tc__label'>{localize('Candle Interval:')}</span>
                        <select value={candleinterval} onChange={event => setCandleInterval(event.target.value)}>
                            {candle_intervals.map(([text, value]) => (
                                <option key={value} value={value}>
                                    {text}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                {has_no_trade_types && (
                    <p className='mw-tc__error'>
                        {localize(
                            'The trade options for this market have not loaded, so there is nothing to run yet. They come from your trading session - sign in, or open the Bot Builder once, and reopen this dialog.'
                        )}
                    </p>
                )}

                {status === 'error' && (
                    <p className='mw-tc__error'>
                        {localize(
                            'The Bot Builder did not finish loading, so the bot was not started. Open Bot Builder and try again.'
                        )}
                    </p>
                )}

                <div className='mw-tc__foot'>
                    <button
                        type='button'
                        className='mw-tc__run'
                        onClick={onRun}
                        disabled={!is_ready || status === 'starting'}
                    >
                        ▶ {status === 'starting' ? localize('Starting…') : localize('Run')}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
});

export default TradingConfiguration;
