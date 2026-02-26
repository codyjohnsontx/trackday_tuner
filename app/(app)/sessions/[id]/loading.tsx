export default function SessionDetailLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="h-6 w-40 rounded bg-zinc-800" />
        <div className="mt-2 h-4 w-28 rounded bg-zinc-800" />
        <div className="mt-1 h-3 w-20 rounded bg-zinc-800" />
      </div>

      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="h-3 w-16 rounded bg-zinc-800" />
          <div className="mt-3 space-y-2">
            <div className="h-4 w-full rounded bg-zinc-800" />
            <div className="h-4 w-4/5 rounded bg-zinc-800" />
            <div className="h-4 w-3/5 rounded bg-zinc-800" />
          </div>
        </div>
      ))}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="h-3 w-32 rounded bg-zinc-800" />
        <div className="mt-3 h-4 w-48 rounded bg-zinc-800" />
        <div className="mt-4 h-10 w-full rounded-xl bg-zinc-800" />
      </div>
    </div>
  );
}
