export default function SessionsLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-6 w-20 rounded bg-surface" />
        <div className="h-9 w-28 rounded-full bg-surface" />
      </div>

      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-card bg-surface p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 w-32 rounded bg-surface-2" />
              <div className="h-3 w-24 rounded bg-surface-2" />
            </div>
            <div className="h-3 w-16 rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
