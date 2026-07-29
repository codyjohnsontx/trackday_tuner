export default function GarageLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-6 w-16 rounded bg-surface-3" />
        <div className="h-9 w-28 rounded-row bg-surface-3" />
      </div>

      {[0, 1, 2].map((i) => (
        <li key={i} className="list-none rounded-card bg-surface p-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 rounded-plate bg-surface-3" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 rounded bg-surface-3" />
              <div className="h-3 w-24 rounded bg-surface-3" />
            </div>
            <div className="h-6 w-16 rounded-plate bg-surface-3" />
          </div>
        </li>
      ))}
    </div>
  );
}
