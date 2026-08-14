interface AmbientBackgroundProps {
  paused: boolean;
  reducedMotion: boolean;
  signal: number;
}

export function AmbientBackground({
  paused,
  reducedMotion,
  signal,
}: AmbientBackgroundProps): React.JSX.Element {
  const canSignal = signal > 0 && !paused && !reducedMotion;

  return (
    <div
      className="cockpit-ambient"
      data-paused={paused ? "true" : "false"}
      aria-hidden="true"
    >
      <div className="cockpit-ambient-grid" />
      <div className="cockpit-ambient-glow cockpit-ambient-glow-a" />
      <div className="cockpit-ambient-glow cockpit-ambient-glow-b" />
      <div className="cockpit-ambient-orbit cockpit-ambient-orbit-a">
        <span />
      </div>
      <div className="cockpit-ambient-orbit cockpit-ambient-orbit-b">
        <span />
      </div>
      {canSignal ? (
        <span className="cockpit-ambient-signal" key={signal} />
      ) : null}
    </div>
  );
}
