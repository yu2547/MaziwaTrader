import { observer } from 'mobx-react-lite';
import WelcomePanel from '@/components/welcome-panel';
import DashboardBotList from './bot-list/dashboard-bot-list';
import DashboardHero from './dashboard-hero';

const DashboardComponent = observer(() => (
    <div className='mw-dashboard-shell'>
        <DashboardHero />
        {/* Renders nothing unless this account is new or has been away a
            while - see components/welcome-panel. */}
        <WelcomePanel />
        {/* Every route that loads a strategy - Upload Bot, Free Bots, Quick
            Strategy, or an edit in Bot Builder - ends in saveWorkspaceToRecent,
            which writes the list this reads. So a bot shows up here the moment
            it is loaded, without a reload. Renders nothing until there is at
            least one. */}
        <DashboardBotList />
    </div>
));

export default DashboardComponent;
