import MarketSceneCanvas from '@/components/market-scene/market-scene-canvas';

// The loading screen's cinematic engine now lives in the shared
// market-scene-canvas component (also used by the landing page hero) so
// there's a single implementation rather than two copies - this file is just
// the loading-screen-specific adapter: progress (0-100) becomes energy
// (0-1), and the per-frame ambient/progress CSS vars are written onto this
// screen's own `.mw-loading__scene` wrapper, exactly as before.
export type TLoadingCanvasProps = {
    // 0-100, mirrors the loading screen's own staged progress - the scene
    // gets subtly more active/energized as this rises, culminating in a
    // fully "energized" world right before the transition.
    progress: number;
};

const LoadingCanvas = ({ progress }: TLoadingCanvasProps) => (
    <MarketSceneCanvas
        energy={progress / 100}
        ambientTargetSelector='.mw-loading__scene'
        className='mw-loading__canvas'
    />
);

export default LoadingCanvas;
