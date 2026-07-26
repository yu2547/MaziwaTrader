import './animated-background.scss';

const PARTICLE_COUNT = 18;
const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => i);

// Pure CSS (transform/opacity only, no canvas/WebGL) so it stays GPU-friendly
// and adds zero bundle weight - a static grid plus a handful of drifting glow
// dots, all driven by keyframes rather than JS per-frame updates.
const AnimatedBackground = () => {
    return (
        <div className='mw-bg' aria-hidden='true'>
            <div className='mw-bg__grid' />
            <div className='mw-bg__glow mw-bg__glow--one' />
            <div className='mw-bg__glow mw-bg__glow--two' />
            <div className='mw-bg__particles'>
                {particles.map(i => (
                    <span
                        key={i}
                        className='mw-bg__particle'
                        style={{
                            left: `${(i * 137.5) % 100}%`,
                            top: `${(i * 53.7) % 100}%`,
                            animationDelay: `${(i % 9) * 0.9}s`,
                            animationDuration: `${9 + (i % 5)}s`,
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

export default AnimatedBackground;
