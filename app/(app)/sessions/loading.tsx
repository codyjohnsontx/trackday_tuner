export default function SessionsLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-6 w-20 rounded bg-zinc-800" />
        <div className="h-9 w-28 rounded-xl bg-zinc-800" />
      </div>

      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 w-32 rounded bg-zinc-800" />
              <div className="h-3 w-24 rounded bg-zinc-800" />
            </div>
            <div className="h-3 w-16 rounded bg-zinc-800" />
          </div>
        </div>
      ))}
    </div>
  );
}
