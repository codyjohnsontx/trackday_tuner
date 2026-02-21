import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-xl font-semibold">Dashboard</h2>
      <p className="mt-2 text-sm text-zinc-300">
        This is a placeholder for the authenticated dashboard experience.
      </p>
      <div className="mt-4">
        <Button variant="secondary">Create First Session</Button>
      </div>
    </section>
  );
}
