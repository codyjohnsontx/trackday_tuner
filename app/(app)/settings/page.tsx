import { TimeFormatSettings } from '@/components/settings/time-format-settings';

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Preferences for how Trackday Tuner displays data on your device.</p>
      </div>
      <TimeFormatSettings />
    </div>
  );
}
