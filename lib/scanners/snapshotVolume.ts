type SnapshotVolume = {
  day?: { v?: number };
  min?: { av?: number; v?: number };
};

function positiveVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function snapshotCumulativeVolume(snapshot: SnapshotVolume): number {
  const volumes = [snapshot.day?.v, snapshot.min?.av, snapshot.min?.v].filter(positiveVolume);
  return volumes.length > 0 ? Math.max(...volumes) : 0;
}
