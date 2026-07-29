export default function DashboardLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="rounded-card bg-surface p-4">
        <div className="h-7 w-32 rounded bg-surface-2" />
        <div className="mt-3 h-4 w-48 rounded bg-surface-2" />
        <div className="mt-4 h-10 w-full rounded-row bg-surface-2" />
      </div>

      <div className="rounded-card bg-surface p-4">
        <div className="h-3 w-14 rounded bg-surface-2" />
        <div className="mt-3 h-4 w-24 rounded bg-surface-2" />
        <div className="mt-2 h-4 w-56 rounded bg-surface-2" />
        <div className="mt-4 h-10 w-full rounded-row bg-surface-2" />
      </div>

      <div className="space-y-3">
        <div className="h-3 w-28 rounded bg-surface" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-card bg-surface p-4">
            <div className="h-4 w-24 rounded bg-surface-2" />
            <div className="mt-2 h-3 w-40 rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
