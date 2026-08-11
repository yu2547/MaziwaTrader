import { observer } from 'mobx-react-lite';
import DashboardHero from './dashboard-hero';

const DashboardComponent = observer(() => (
    <div className='mw-dashboard-shell'>
        <DashboardHero />
    </div>
));

export default DashboardComponent;
