export default function GarageLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-6 w-16 rounded bg-zinc-800" />
        <div className="h-9 w-28 rounded-xl bg-zinc-800" />
      </div>

      {[0, 1, 2].map((i) => (
        <li key={i} className="list-none rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 rounded-lg bg-zinc-800" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 rounded bg-zinc-800" />
              <div className="h-3 w-24 rounded bg-zinc-800" />
            </div>
            <div className="h-6 w-16 rounded-lg bg-zinc-800" />
          </div>
        </li>
      ))}
    </div>
  );
}
