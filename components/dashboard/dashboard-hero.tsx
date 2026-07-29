import Image from 'next/image';
import Link from 'next/link';
import { Bike, ChevronRight } from 'lucide-react';
import { Eyebrow } from '@/components/ui/surface';

interface DashboardHeroProps {
  /** Nickname of the vehicle the rider is running, or null before one exists. */
  vehicleName: string | null;
  /** One-line account of the most recent outing, already formatted. */
  lastRun: string | null;
}

/**
 * The one image on the screen, and the only card allowed to be atmospheric
 * rather than informational. It answers the question a rider actually opens
 * the app with — which bike am I on, and when was I last out — and hands off
 * to the garage for anything more.
 */
export function DashboardHero({ vehicleName, lastRun }: DashboardHeroProps) {
  const hasVehicle = Boolean(vehicleName);

  return (
    <Link
      href={hasVehicle ? '/garage' : '/garage/new'}
      className="group relative block overflow-hidden rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      {/* Photo: Harlie Raethel via Unsplash */}
      <Image
        src="/images/login-hero.jpg"
        alt=""
        fill
        priority
        sizes="(min-width: 1024px) 1024px, 100vw"
        className="object-cover object-[65%_45%] opacity-55"
      />
      {/* Two scrims, not one: the lower ramp carries the text, the flat wash
          keeps the top corners from glaring against the canvas. */}
      <div className="absolute inset-0 bg-canvas/25" />
      <div className="absolute inset-x-0 bottom-0 h-4/5 bg-gradient-to-t from-canvas via-canvas/70 to-transparent" />

      <div className="relative flex min-h-56 flex-col justify-between gap-6 p-5">
        <div className="flex items-start justify-between gap-3">
          <Eyebrow icon={Bike} className="text-ink-dim">
            {hasVehicle ? 'In the garage' : 'Get started'}
          </Eyebrow>
          <ChevronRight
            className="h-5 w-5 shrink-0 text-ink-dim transition group-hover:translate-x-0.5 group-hover:text-ink"
            aria-hidden
          />
        </div>

        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            {vehicleName ?? 'No vehicle yet'}
          </h2>
          <p className="mt-1.5 text-sm text-ink-dim">
            {lastRun ?? 'Add a vehicle to start logging track sessions.'}
          </p>
        </div>
      </div>
    </Link>
  );
}
