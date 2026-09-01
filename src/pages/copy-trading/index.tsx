import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from '@deriv-com/translations';
import './copy-trading.scss';

type TAccountType = 'real' | 'demo';

type TClient = {
    account_type: TAccountType;
    id: string;
    token: string;
};

/**
 * Tokens live in this component's state and nowhere else - not localStorage,
 * not sessionStorage, not a store that outlives the page. They are live
 * trading credentials for somebody else's account, so a refresh clears them
 * rather than leaving them sitting in browser storage.
 */
const maskToken = (token: string) => (token.length <= 4 ? '••••' : `••••${token.slice(-4)}`);

const CopyTradingPage = observer(() => {
    const { localize } = useTranslations();

    const [clients, setClients] = useState<TClient[]>([]);
    const [token_input, setTokenInput] = useState('');
    const [account_type, setAccountType] = useState<TAccountType>('real');
    const [status, setStatus] = useState<string | null>(null);

    const addClient = () => {
        const token = token_input.trim();
        if (!token) return;
        if (clients.some(client => client.token === token)) {
            setStatus(localize('That token is already on the list.'));
            return;
        }
        setClients(prev => [
            ...prev,
            { account_type, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, token },
        ]);
        setTokenInput('');
        setStatus(null);
    };

    const removeClient = (id: string) => setClients(prev => prev.filter(client => client.id !== id));

    // Said rather than mimed. The buttons are here because this is the shape
    // the page is meant to have, but copying a trade means buying a contract on
    // somebody else's account, and nothing in this build does that - so they
    // report the truth instead of a spinner that leads nowhere.
    const notWired = () =>
        setStatus(
            localize(
                'Copy execution is not connected in this build, so nothing is copied yet. Tokens added here stay in this browser tab and are cleared when you leave.'
            )
        );

    const latest = clients[clients.length - 1];

    return (
        <div className='mw-copy'>
            <button type='button' className='mw-copy__go' onClick={notWired}>
                {localize('Start Demo to Real Copy Trading')}
            </button>

            <div className='mw-copy__panel mw-copy__tokens'>
                <b>
                    {clients.length === 0 && localize('No tokens')}
                    {clients.length === 1 && localize('1 token')}
                    {clients.length > 1 && localize('{{count}} tokens', { count: clients.length })}
                </b>
                <span className='mw-copy__mask'>{latest ? maskToken(latest.token) : '••••••'}</span>
            </div>

            <div className='mw-copy__panel'>
                <div className='mw-copy__add'>
                    <input
                        type='password'
                        className='mw-copy__token-input'
                        placeholder={localize("Enter follower's Deriv v2 API token (PAT, trade scope)")}
                        aria-label={localize("Follower's Deriv v2 API token")}
                        value={token_input}
                        onChange={event => setTokenInput(event.target.value)}
                        onKeyDown={event => event.key === 'Enter' && addClient()}
                    />
                    <select
                        className='mw-copy__type'
                        aria-label={localize('Account type')}
                        value={account_type}
                        onChange={event => setAccountType(event.target.value as TAccountType)}
                    >
                        <option value='real'>{localize('Real')}</option>
                        <option value='demo'>{localize('Demo')}</option>
                    </select>
                    <button
                        type='button'
                        className='mw-copy__add-btn'
                        onClick={addClient}
                        disabled={!token_input.trim()}
                    >
                        {localize('Add')}
                    </button>
                    <button type='button' className='mw-copy__sync' onClick={notWired}>
                        {localize('Sync')} <span aria-hidden='true'>↻</span>
                    </button>
                </div>

                <button type='button' className='mw-copy__go' onClick={notWired}>
                    {localize('Start Copy Trading')}
                </button>
            </div>

            <div className='mw-copy__panel'>
                {clients.length > 0 && (
                    <ul className='mw-copy__list'>
                        {clients.map(client => (
                            <li key={client.id} className='mw-copy__row'>
                                <span className={`mw-copy__badge mw-copy__badge--${client.account_type}`}>
                                    {client.account_type === 'real' ? localize('Real') : localize('Demo')}
                                </span>
                                <span className='mw-copy__row-token'>{maskToken(client.token)}</span>
                                <button
                                    type='button'
                                    className='mw-copy__remove'
                                    onClick={() => removeClient(client.id)}
                                    aria-label={localize('Remove this client')}
                                >
                                    ✕
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <b className='mw-copy__total'>
                    {localize('Total Clients added')}: {clients.length}
                </b>
            </div>

            {status && <p className='mw-copy__status'>{status}</p>}
        </div>
    );
});

export default CopyTradingPage;
