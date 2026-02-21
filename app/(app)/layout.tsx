export default function AuthenticatedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h1 className="text-lg font-semibold">Authenticated App</h1>
        <p className="mt-1 text-sm text-zinc-300">
          Placeholder shell for protected app routes.
        </p>
      </header>
      {children}
    </div>
  );
}
