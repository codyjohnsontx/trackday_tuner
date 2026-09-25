// The symptom chips and change intents the Race Engineer form offers. The
// request carries the ids; anything a rider reads back - the form, and the
// list of their held questions in Settings - prints the label.
export const SYMPTOM_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'understeer_entry', label: 'Understeer on entry' },
  { id: 'understeer_mid', label: 'Understeer mid-corner' },
  { id: 'oversteer_entry', label: 'Oversteer on entry' },
  { id: 'oversteer_exit', label: 'Oversteer on exit' },
  { id: 'front_chatter', label: 'Front chatter' },
  { id: 'rear_wallow', label: 'Rear wallow' },
  { id: 'packing_down', label: 'Packing down' },
  { id: 'brake_dive', label: 'Brake dive' },
  { id: 'low_grip_cold', label: 'Low grip (cold)' },
  { id: 'overheating_tire', label: 'Overheating tire' },
];

export const INTENT_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'stability_over_entry', label: 'Stability on entry' },
  { id: 'sharper_turn_in', label: 'Sharper turn-in' },
  { id: 'more_exit_grip', label: 'More exit grip' },
  { id: 'reduce_tire_wear', label: 'Reduce tire wear' },
  { id: 'better_feel', label: 'Better feel' },
];

/** The label for a chip id, or the text itself when it is not one of ours. */
export function raceEngineerOptionLabel(
  options: ReadonlyArray<{ id: string; label: string }>,
  id: string,
): string {
  return options.find((option) => option.id === id)?.label ?? id;
}
