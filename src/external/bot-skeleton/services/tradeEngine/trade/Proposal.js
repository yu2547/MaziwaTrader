import { localize } from '@deriv-com/translations';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { doUntilDone, tradeOptionToProposal } from '../utils/helpers';
import { clearProposals, proposalsReady } from './state/actions';

// A bot cannot buy until every proposal it asked for has come back and been
// matched to its template. Nothing in that path has a timeout, so if a price
// never arrives - or arrives in a shape the matcher does not recognise - the
// run simply sits at "before purchase" forever: no contract, no error, no
// indication anything is wrong. This is how long to wait before saying so.
const PROPOSAL_READY_TIMEOUT_MS = 15000;

export default Engine =>
    class Proposal extends Engine {
        makeProposals(trade_option) {
            if (!this.isNewTradeOption(trade_option)) {
                return;
            }

            // Generate a purchase reference when trade options are different from previous trade options.
            // This will ensure the bot doesn't mistakenly purchase the wrong proposal.
            this.regeneratePurchaseReference();
            this.trade_option = trade_option;
            this.proposal_templates = tradeOptionToProposal(
                trade_option,
                this.getPurchaseReference(),
                api_base.is_otp_transport
            );
            this.renewProposalsOnPurchase();
        }

        selectProposal(contract_type) {
            const { proposals } = this.data;

            if (proposals.length === 0) {
                throw Error(localize('Proposals are not ready'));
            }

            const to_buy = proposals.find(proposal => {
                if (
                    proposal.contract_type === contract_type &&
                    proposal.purchase_reference === this.getPurchaseReference()
                ) {
                    // Below happens when a user has had one of the proposals return
                    // with a ContractBuyValidationError. We allow the logic to continue
                    // to here cause the opposite proposal may still be valid. Only once
                    // they attempt to purchase the errored proposal we will intervene.
                    if (proposal.error) {
                        throw proposal.error;
                    }

                    return proposal;
                }

                return false;
            });

            if (!to_buy) {
                throw new Error(localize('Selected proposal does not exist'));
            }

            return {
                id: to_buy.id,
                askPrice: to_buy.ask_price,
            };
        }

        renewProposalsOnPurchase() {
            this.data.proposals = [];
            this.store.dispatch(clearProposals());
            this.requestProposals();
        }

        // Reports where the handshake stalled instead of letting the run hang
        // silently. The three cases are genuinely different problems and the
        // journal line has to say which one it is, or the next step is another
        // round of guesswork.
        startProposalWatchdog() {
            this.clearProposalWatchdog();
            this.proposals_matched = false;
            this.proposal_watchdog = setTimeout(() => {
                // Stopping the bot inside the window is not a stall, and a run
                // that has moved past this point does not need telling either.
                if (this.$scope?.stopped || api_base.is_stopping) return;

                const expected = this.proposal_templates?.length ?? 0;
                const received = this.data.proposals.length;

                if (this.proposals_matched) {
                    // Matched, but proposalsReady() is dispatched behind
                    // startPromise - which only resolves once some message has
                    // arrived on the socket since the engine started.
                    globalObserver.emit(
                        'ui.log.error',
                        localize(
                            'Prices arrived but the run never started. The bot is still waiting on the account to report in.'
                        )
                    );
                    return;
                }

                if (received === 0) {
                    globalObserver.emit(
                        'ui.log.error',
                        localize(
                            'No prices came back for this contract after {{seconds}}s, so there was nothing to buy. Check the market and trade type are open for trading.',
                            { seconds: Math.round(PROPOSAL_READY_TIMEOUT_MS / 1000) }
                        )
                    );
                    return;
                }

                // Prices came back but did not match what was asked for -
                // the response is missing the fields the matcher keys on.
                globalObserver.emit(
                    'ui.log.error',
                    localize(
                        '{{received}} of {{expected}} prices came back but could not be matched to this trade, so the bot did not buy.',
                        { received, expected }
                    )
                );
            }, PROPOSAL_READY_TIMEOUT_MS);
        }

        clearProposalWatchdog() {
            if (this.proposal_watchdog) {
                clearTimeout(this.proposal_watchdog);
                this.proposal_watchdog = null;
            }
        }

        requestProposals() {
            this.startProposalWatchdog();
            // Since there are two proposals (in most cases), an error may be logged twice, to avoid this
            // flip this boolean on error.
            let has_informed_error = false;

            Promise.all(
                this.proposal_templates.map(proposal => {
                    doUntilDone(() => api_base.api.send(proposal)).catch(error => {
                        // We intercept ContractBuyValidationError as user may have specified
                        // e.g. a DIGITUNDER 0 or DIGITOVER 9, while one proposal may be invalid
                        // the other is valid. We will error on Purchase rather than here.

                        if (error?.error?.code === 'ContractBuyValidationError') {
                            this.data.proposals.push({
                                ...error.error.echo_req,
                                ...error.echo_req.passthrough,
                                error,
                            });

                            return null;
                        }
                        if (!has_informed_error) {
                            has_informed_error = true;
                            this.$scope.observer.emit('Error', error.error);
                        }
                        return null;
                    });
                })
            );
        }

        observeProposals() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(response => {
                if (response.data.msg_type === 'proposal') {
                    const { passthrough, proposal } = response.data;
                    if (proposal && this.data.proposals.findIndex(p => p.id === proposal.id) === -1) {
                        // Add proposals based on the ID returned by the API.
                        this.data.proposals.push({ ...proposal, ...passthrough });
                        this.checkProposalReady();
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        checkProposalReady() {
            // Proposals are considered ready when the proposals in our memory match the ones
            // we've requested from the API, we determine this by checking the passthrough of the response.
            const { proposals } = this.data;

            if (proposals.length > 0 && this.proposal_templates) {
                const has_equal_proposals = this.proposal_templates.every(template => {
                    return (
                        proposals.findIndex(proposal => {
                            return (
                                proposal.purchase_reference === template.passthrough.purchase_reference &&
                                proposal.contract_type === template.contract_type
                            );
                        }) !== -1
                    );
                });

                if (has_equal_proposals) {
                    this.proposals_matched = true;
                    // Everything past this point waits on startPromise, which
                    // only settles once a message has arrived on the socket
                    // since the engine started. The watchdog above reports it
                    // if that never happens.
                    this.startPromise.then(() => {
                        this.clearProposalWatchdog();
                        this.store.dispatch(proposalsReady());
                    });
                }
            }
        }

        isNewTradeOption(trade_option) {
            if (!this.trade_option) {
                this.trade_option = trade_option;
                return true;
            }

            // Compare incoming "trade_option" argument with "this.trade_option", if any
            // of the values is different, this is a new tradeOption and new proposals
            // should be generated.
            return [
                'amount',
                'barrierOffset',
                'basis',
                'duration',
                'duration_unit',
                'prediction',
                'secondBarrierOffset',
                'symbol',
            ].some(value => this.trade_option[value] !== trade_option[value]);
        }
    };
