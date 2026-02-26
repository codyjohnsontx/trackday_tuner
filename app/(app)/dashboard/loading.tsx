export default function DashboardLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="h-7 w-32 rounded bg-zinc-800" />
        <div className="mt-3 h-4 w-48 rounded bg-zinc-800" />
        <div className="mt-4 h-10 w-full rounded-xl bg-zinc-800" />
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="h-3 w-14 rounded bg-zinc-800" />
        <div className="mt-3 h-4 w-24 rounded bg-zinc-800" />
        <div className="mt-2 h-4 w-56 rounded bg-zinc-800" />
        <div className="mt-4 h-10 w-full rounded-xl bg-zinc-800" />
      </div>

      <div className="space-y-3">
        <div className="h-3 w-28 rounded bg-zinc-800" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="h-4 w-24 rounded bg-zinc-800" />
            <div className="mt-2 h-3 w-40 rounded bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
