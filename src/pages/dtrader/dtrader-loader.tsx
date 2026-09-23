import { useTranslations } from '@deriv-com/translations';
import './dtrader-loader.scss';

/**
 * What DTrader shows while it is opening.
 *
 * Drawn from the phone recording of the reference frame by frame, not from a
 * description of it: on a #0d101b ground, a teal sphere with two thin
 * elliptical orbits turning around it at different rates, and one line beneath.
 * Everything below is measured off that recording at its own 396px width - the
 * sphere 24px across, the orbits 65x23, their stroke a pixel, the line 14px in
 * #b1b6c3 sitting 22px under the artwork.
 *
 * It stands for the whole wait, which is why it is a component of its own: the
 * route shows it while the page's chunk is on its way (App.tsx), and the page
 * shows the same thing while it waits for its first ticks. One picture, held
 * from the tap to the market - the reference never flashes a second loader
 * between the two, and neither does this.
 *
 * Deliberately small, with a stylesheet of its own rather than dtrader.scss:
 * the router imports it, so it has to be on screen before the DTrader chunk it
 * is waiting for has arrived.
 */

type TDTraderLoaderProps = {
    /**
     * Over the page rather than in place of it - what the page itself uses
     * once it is mounted and waiting on the feed.
     */
    is_cover?: boolean;
};

const DTraderLoader = ({ is_cover = false }: TDTraderLoaderProps) => {
    const { localize } = useTranslations();

    return (
        <div className={`mw-dt-loader${is_cover ? ' mw-dt-loader--cover' : ''}`} role='status'>
            <div className='mw-dt-loader__art'>
                <svg className='mw-dt-loader__atom' viewBox='0 0 100 100' aria-hidden='true'>
                    <defs>
                        {/* The sphere is lit from its upper left in the
                            reference: #8ed1d2 at the highlight, #6bb6b5 across
                            the middle, #3d8a8c where it turns away. */}
                        <radialGradient id='mw-dt-loader-core' cx='34%' cy='30%' r='78%'>
                            <stop offset='0%' stopColor='#c2e8e4' />
                            <stop offset='28%' stopColor='#8ed1d2' />
                            <stop offset='68%' stopColor='#6bb6b5' />
                            <stop offset='100%' stopColor='#3d8a8c' />
                        </radialGradient>
                    </defs>

                    {/* Three orbits, counted off a frame sequence pulled at
                        six a second: they sit a third of a turn apart and hold
                        that, while the whole set turns slowly - which is why
                        the recording's never fall into line with one another
                        and read as a single ring. Each carries a bright arc
                        running round it at its own rate. */}
                    <g className='mw-dt-loader__rings'>
                        {['a', 'b', 'c'].map(ring => (
                            <g key={ring} className={`mw-dt-loader__ring mw-dt-loader__ring--${ring}`}>
                                <ellipse className='mw-dt-loader__orbit' cx='50' cy='50' rx='42' ry='15' />
                                <ellipse className='mw-dt-loader__spark' cx='50' cy='50' rx='42' ry='15' />
                            </g>
                        ))}
                    </g>

                    {/* Drawn last, so the orbits pass behind it as they do
                        there rather than across its face. */}
                    <circle className='mw-dt-loader__core' cx='50' cy='50' r='14' fill='url(#mw-dt-loader-core)' />
                </svg>
            </div>

            <p className='mw-dt-loader__text'>{localize('Please wait for DTrader to open')}</p>
        </div>
    );
};

export default DTraderLoader;
