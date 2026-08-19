import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import { localize } from '@deriv-com/translations';
import { config } from '../../../constants/config';
import { MessageTypes } from '../../../constants/messages';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { checkBlocksForProposalRequest, doUntilDone, readVirtualHookFromWorkspace } from '../utils/helpers';
import { expectInitArg } from '../utils/sanitize';
import VirtualHookRunner from '../utils/virtual-hook-runner';
import { proposalsReady, start } from './state/actions';
import * as constants from './state/constants';
import rootReducer from './state/reducers';
import Balance from './Balance';
import OpenContract from './OpenContract';
import Proposal from './Proposal';
import Purchase from './Purchase';
import Sell from './Sell';
import Ticks from './Ticks';
import Total from './Total';

const watchBefore = store =>
    watchScope({
        store,
        stopScope: constants.DURING_PURCHASE,
        passScope: constants.BEFORE_PURCHASE,
        passFlag: 'proposalsReady',
    });

const watchDuring = store =>
    watchScope({
        store,
        stopScope: constants.STOP,
        passScope: constants.DURING_PURCHASE,
        passFlag: 'openContract',
    });

/* The watchScope function is called randomly and resets the prevTick
 * which leads to the same problem we try to solve. So prevTick is isolated
 */
let prevTick;
const watchScope = ({ store, stopScope, passScope, passFlag }) => {
    // in case watch is called after stop is fired
    if (store.getState().scope === stopScope) {
        return Promise.resolve(false);
    }
    return new Promise(resolve => {
        const unsubscribe = store.subscribe(() => {
            const newState = store.getState();

            if (newState.newTick === prevTick) return;
            prevTick = newState.newTick;

            if (newState.scope === passScope && newState[passFlag]) {
                unsubscribe();
                resolve(true);
            }

            if (newState.scope === stopScope) {
                unsubscribe();
                resolve(false);
            }
        });
    });
};

export default class TradeEngine extends Balance(Purchase(Sell(OpenContract(Proposal(Ticks(Total(class {}))))))) {
    constructor($scope) {
        super();
        this.observer = $scope.observer;
        this.$scope = $scope;
        this.observe();
        this.data = {
            contract: {},
            proposals: [],
        };
        this.subscription_id_for_accumulators = null;
        this.is_proposal_requested_for_accumulators = false;
        // Constructed disabled; start() configures it from the workspace.
        this.virtual_hook = new VirtualHookRunner();
        this.store = createStore(rootReducer, applyMiddleware(thunk));

        // observeBalance/observeProposals/observeOpenContract (called by observe()
        // above) each bind their own api_base.api.onMessage() listener once, at
        // construction time, to whichever socket is live *right now*. If api_base
        // later replaces that socket (a forced reconnect), those listeners are left
        // listening to a dead socket's message stream forever - balance/proposal/
        // contract updates would silently stop reaching a running bot until a full
        // page reload. api_base.onReconnected is a single-slot callback (not an
        // accumulating event registration - see api-base.ts for why that matters
        // given a new TradeEngine is constructed on every bot run) that fires once
        // subscriptions are confirmed restored after a reconnect; re-running
        // observe() rebinds all three listeners against the current api_base.api,
        // and ticksService needs the same treatment for its own tick/candle
        // subscriptions.
        api_base.onReconnected(() => {
            this.observe();
            this.$scope.ticksService?.restoreSubscriptions?.();
        });
    }

    init(...args) {
        const [token, options] = expectInitArg(args);
        const { symbol } = options;

        this.initArgs = args;
        this.options = options;
        this.startPromise = this.loginAndGetBalance(token);

        if (!this.checkTicksPromiseExists()) this.watchTicks(symbol);
    }

    start(tradeOptions) {
        if (!this.options) {
            throw createError('NotInitialized', localize('Bot.init is not called'));
        }

        globalObserver.emit('bot.running');

        const validated_trade_options = this.validateTradeOptions(tradeOptions);

        this.tradeOptions = { ...validated_trade_options, symbol: this.options.symbol };
        this.store.dispatch(start());
        this.checkLimits(validated_trade_options);

        // Read once per run, from the block the user actually ticked. Disabled
        // is the default and costs nothing, so a bot without the hook behaves
        // exactly as it did before this existed.
        this.virtual_hook.configure(readVirtualHookFromWorkspace());
        if (this.virtual_hook.is_enabled) {
            globalObserver.emit('ui.log.notify', {
                message: localize(
                    'Virtual Hook on: watching for {{steps}} virtual loss(es) before trading real money.',
                    { steps: this.virtual_hook.settings.max_virtual_loss_steps }
                ),
                message_type: MessageTypes.NOTIFY,
                className: 'journal__text',
                sound: config().lists.NOTIFICATION_SOUND[0][1],
            });
        }

        this.makeDirectPurchaseDecision();
    }

    loginAndGetBalance(token) {
        if (this.token === token) {
            return Promise.resolve();
        }
        // for strategies using total runs, GetTotalRuns function is trying to get loginid and it gets called before Proposals calls.
        // the below required loginid to be set in Proposal calls where loginAndGetBalance gets resolved.
        // Earlier this used to happen as soon as we get ticks_history response and by the time GetTotalRuns gets called we have required info.
        this.accountInfo = api_base.account_info;
        this.token = api_base.token;
        return new Promise(resolve => {
            // Try to recover from a situation where API doesn't give us a correct response on
            // "proposal_open_contract" which would make the bot run forever. When there's a "sell"
            // event, wait a couple seconds for the API to give us the correct "proposal_open_contract"
            // response, if there's none after x seconds. Send an explicit request, which _should_
            // solve the issue. This is a backup!
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'transaction' && data.transaction.action === 'sell') {
                    this.transaction_recovery_timeout = setTimeout(() => {
                        const { contract } = this.data;
                        const is_same_contract = contract.contract_id === data.transaction.contract_id;
                        const is_open_contract = contract.status === 'open';
                        if (is_same_contract && is_open_contract) {
                            doUntilDone(() => {
                                api_base.api.send({ proposal_open_contract: 1, contract_id: contract.contract_id });
                            }, ['PriceMoved']);
                        }
                    }, 1500);
                }
                resolve();
            });
            api_base.pushSubscription(subscription);
        });
    }

    observe() {
        this.observeOpenContract();
        this.observeBalance();
        this.observeProposals();
    }

    watch(watchName) {
        if (watchName === 'before') {
            return watchBefore(this.store);
        }
        return watchDuring(this.store);
    }

    makeDirectPurchaseDecision() {
        const { has_payout_block, is_basis_payout } = checkBlocksForProposalRequest();
        // The OTP transport always goes through a proposal, whatever the
        // strategy looks like. The direct path buys from a `parameters`
        // object built locally, and the Options API rejects that object -
        // "Input validation failed: parameters" - where it accepts the
        // proposal request this app has already exercised against it live.
        // Buying by proposal id sends `{buy: <id>, price}` and no parameters
        // at all, so there is nothing left for it to disagree with.
        this.is_proposal_subscription_required = has_payout_block || is_basis_payout || api_base.is_otp_transport;

        if (this.is_proposal_subscription_required) {
            this.makeProposals({ ...this.options, ...this.tradeOptions });
            this.checkProposalReady();
        } else {
            this.store.dispatch(proposalsReady());
        }
    }
}
