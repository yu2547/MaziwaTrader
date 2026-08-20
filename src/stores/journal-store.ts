import { action, computed, makeObservable, observable, reaction, when } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { formatDate } from '@/components/shared';
import { LogTypes, MessageTypes } from '@/external/bot-skeleton';
import { config } from '@/external/bot-skeleton/constants/config';
import { localize } from '@deriv-com/translations';
import { getActiveAccountId } from '../utils/active-account-id';
import { isDebugEnabled } from '../utils/debug-log';
import { isCustomJournalMessage } from '../utils/journal-notifications';
import { getStoredItemsByKey, getStoredItemsByUser, setStoredItemsByKey } from '../utils/session-storage';
import { getSetting, storeSetting } from '../utils/settings';
import { TAccountList } from './client-store';
import RootStore from './root-store';

type TExtra = {
    current_currency?: string;
    currency?: string;
    profit?: number;
};

type TlogSuccess = {
    log_type: string;
    extra: TExtra;
};

type TMessage = {
    message: string | Error;
    message_type: string;
    className?: string;
};

type TMessageItem = {
    date?: string;
    time?: string;
    unique_id: string;
    extra: TExtra;
} & TMessage;

type TNotifyData = {
    sound: string;
    block_id?: string;
    variable_name?: string;
} & TMessage;

export interface IJournalStore {
    is_filter_dialog_visible: boolean;
    journal_filters: string[];
    filters: { id: string; label: string }[];
    unfiltered_messages: TMessageItem[];
    toggleFilterDialog: () => void;
    onLogSuccess: (message: TlogSuccess) => void;
    onError: (message: Error | string) => void;
    onNotify: (data: TNotifyData) => void;
    pushMessage: (message: string, message_type: string, className: string, extra?: TExtra) => void;
    filtered_messages: TMessageItem[];
    getServerTime: () => Date;
    playAudio: (sound: string) => void;
    checked_filters: string[];
    filterMessage: (checked: boolean, item_id: string) => void;
    clear: () => void;
    registerReactions: () => void;
    restoreStoredJournals: () => void;
}

export default class JournalStore {
    root_store: RootStore;
    core: RootStore['core'];
    disposeReactionsFn: () => void;
    constructor(root_store: RootStore, core: RootStore['core']) {
        makeObservable(this, {
            is_filter_dialog_visible: observable,
            journal_filters: observable.shallow,
            filters: observable.shallow,
            unfiltered_messages: observable.shallow,
            toggleFilterDialog: action.bound,
            onLogSuccess: action.bound,
            onError: action.bound,
            onNotify: action.bound,
            pushMessage: action.bound,
            filtered_messages: computed,
            getServerTime: action.bound,
            playAudio: action.bound,
            checked_filters: computed,
            filterMessage: action.bound,
            clear: action.bound,
            registerReactions: action.bound,
            restoreStoredJournals: action.bound,
        });

        this.root_store = root_store;
        this.core = core;
        this.disposeReactionsFn = this.registerReactions();
        this.restoreStoredJournals();
    }

    JOURNAL_CACHE = 'journal_cache';

    is_filter_dialog_visible = false;

    filters = [
        { id: MessageTypes.ERROR, label: localize('Errors') },
        { id: MessageTypes.NOTIFY, label: localize('Notifications') },
        { id: MessageTypes.SUCCESS, label: localize('System') },
    ];
    journal_filters: string[] = [];
    unfiltered_messages: TMessageItem[] = [];
    /** TEMP-DIAGNOSTIC: caps the read log so a computed cannot flood output. */
    read_log_count = 0;

    restoreStoredJournals() {
        const client = this.core.client as RootStore['client'];
        this.journal_filters = getSetting('journal_filter') ?? this.filters.map(filter => filter.id);
        this.unfiltered_messages = getStoredItemsByUser(this.JOURNAL_CACHE, getActiveAccountId(client), []);
    }

    getServerTime() {
        return this.core?.common.server_time.get();
    }

    playAudio = (sound: string) => {
        if (sound !== config().lists.NOTIFICATION_SOUND[0][1]) {
            const audio = document.getElementById(sound) as HTMLAudioElement;
            audio.play();
        }
    };

    toggleFilterDialog() {
        this.is_filter_dialog_visible = !this.is_filter_dialog_visible;
    }

    onLogSuccess(message: TlogSuccess) {
        const { log_type, extra } = message;
        this.pushMessage(log_type, MessageTypes.SUCCESS, '', extra);
    }

    onError(message: Error | string) {
        this.pushMessage(message, MessageTypes.ERROR);
    }

    onNotify(data: TNotifyData) {
        const { run_panel, dbot } = this.root_store;
        const { message, className, message_type, sound, block_id, variable_name } = data;

        if (
            isCustomJournalMessage(
                { message, block_id, variable_name },
                run_panel.showErrorMessage,
                () => dbot.centerAndHighlightBlock(block_id as string, true),
                (parsed_message: string) =>
                    this.pushMessage(parsed_message, message_type || MessageTypes.NOTIFY, className)
            )
        ) {
            this.playAudio(sound);
            return;
        }
        this.pushMessage(message, message_type || MessageTypes.NOTIFY, className);
        this.playAudio(sound);
    }

    pushMessage(
        message: Error | string,
        message_type: string,
        className?: string,
        extra: { current_currency?: string; currency?: string } = {}
    ) {
        const { client } = this.core;
        const { loginid, account_list } = client as RootStore['client'];

        if (loginid) {
            const current_account = account_list?.find(account => account?.loginid === loginid);
            extra.current_currency = current_account?.is_virtual ? 'Demo' : current_account?.currency;
        } else if (message === LogTypes.WELCOME) {
            return;
        }

        const date = formatDate(this.getServerTime());
        const time = formatDate(this.getServerTime(), 'HH:mm:ss [GMT]');
        const unique_id = uuidv4();

        this.unfiltered_messages.unshift({ date, time, message, message_type, className, unique_id, extra });
        this.unfiltered_messages = this.unfiltered_messages.slice(); // force array update

        // TEMP-DIAGNOSTIC (localStorage mw_debug = '1'): a message reached the
        // journal. If the panel is empty and none of these ever print, the
        // observer listeners are not registered and nothing is arriving - a
        // different problem from messages arriving and being filtered out.
        if (isDebugEnabled()) {
            // eslint-disable-next-line no-console
            console.info(
                `[MW-JOURNAL] PUSH type='${message_type}' total=${this.unfiltered_messages.length} ` +
                    `filters=[${this.journal_filters.join(',')}]`
            );
        }
    }

    get filtered_messages() {
        const rows = this.unfiltered_messages
            // filter messages based on filtered-checkbox
            .filter(
                message =>
                    this.journal_filters.length && this.journal_filters.some(filter => message.message_type === filter)
            );

        // TEMP-DIAGNOSTIC (localStorage mw_debug = '1'): the read side, paired
        // with PUSH above. `held` greater than zero while `shown` is zero means
        // the messages are there and the saved filter set is hiding them -
        // journal_filters is restored from a persisted setting, so an empty or
        // stale one silently blanks the panel. Capped, since this is a computed.
        if (isDebugEnabled() && this.read_log_count < 30) {
            this.read_log_count += 1;
            // eslint-disable-next-line no-console
            console.info(
                `[MW-JOURNAL] read #${this.read_log_count} held=${this.unfiltered_messages.length} ` +
                    `shown=${rows.length} filters=[${this.journal_filters.join(',')}]`
            );
        }

        return rows;
    }

    get checked_filters() {
        return this.journal_filters.filter(filter => filter != null);
    }

    filterMessage(checked: boolean, item_id: string) {
        if (checked) {
            this.journal_filters.push(item_id);
        } else {
            this.journal_filters.splice(this.journal_filters.indexOf(item_id), 1);
        }

        storeSetting('journal_filter', this.journal_filters);
    }

    clear() {
        this.unfiltered_messages = this.unfiltered_messages.slice(0, 0);
    }

    registerReactions() {
        const client = this.core.client as RootStore['client'];

        // Write journal messages to session storage on each change in unfiltered messages.
        const disposeWriteJournalMessageListener = reaction(
            () => this.unfiltered_messages,
            unfiltered_messages => {
                const stored_journals = getStoredItemsByKey(this.JOURNAL_CACHE, {});
                stored_journals[getActiveAccountId(client)] = unfiltered_messages?.slice(0, 5000);
                setStoredItemsByKey(this.JOURNAL_CACHE, stored_journals);
            }
        );

        // Attempt to load cached journal messages on client loginid change.
        const disposeJournalMessageListener = reaction(
            () => client?.loginid,
            async loginid => {
                await when(() => {
                    const has_account = client.account_list?.find(
                        (account: TAccountList[number]) => account.loginid === loginid
                    );
                    return !!has_account;
                });
                this.unfiltered_messages = getStoredItemsByUser(this.JOURNAL_CACHE, loginid, []);
                if (this.unfiltered_messages.length === 0) {
                    this.pushMessage(LogTypes.WELCOME, MessageTypes.SUCCESS, 'journal__text');
                } else if (this.unfiltered_messages.length > 0) {
                    this.pushMessage(LogTypes.WELCOME_BACK, MessageTypes.SUCCESS, 'journal__text');
                }
            },
            { fireImmediately: true } // For initial welcome message
        );

        return () => {
            disposeWriteJournalMessageListener();
            disposeJournalMessageListener();
        };
    }
}
