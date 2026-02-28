import type {
  Alignment,
  ExtraModules,
  Session,
  SessionAdvancedVisibility,
  SessionEnabledModules,
  SessionModuleKey,
  VehicleType,
} from '@/types';

export interface SessionModuleConfig {
  key: SessionModuleKey;
  label: string;
  advancedLabel?: string;
}

export const sessionModuleConfigs: Record<SessionModuleKey, SessionModuleConfig> = {
  tires: { key: 'tires', label: 'Tires', advancedLabel: 'Show tire details' },
  suspension: { key: 'suspension', label: 'Suspension' },
  alignment: { key: 'alignment', label: 'Alignment', advancedLabel: 'Show advanced fields' },
  geometry: { key: 'geometry', label: 'Geometry', advancedLabel: 'Show advanced fields' },
  drivetrain: { key: 'drivetrain', label: 'Drivetrain', advancedLabel: 'Show advanced fields' },
  aero: { key: 'aero', label: 'Aero', advancedLabel: 'Show advanced fields' },
  notes: { key: 'notes', label: 'Notes' },
};

const allModuleKeys: SessionModuleKey[] = [
  'tires',
  'suspension',
  'alignment',
  'geometry',
  'drivetrain',
  'aero',
  'notes',
];

const availableModulesByVehicle: Record<VehicleType, SessionModuleKey[]> = {
  motorcycle: ['tires', 'suspension', 'geometry', 'drivetrain', 'notes'],
  car: ['tires', 'suspension', 'alignment', 'aero', 'notes'],
};

const defaultEnabledByVehicle: Record<VehicleType, SessionEnabledModules> = {
  motorcycle: {
    tires: true,
    suspension: true,
    alignment: false,
    geometry: false,
    drivetrain: false,
    aero: false,
    notes: true,
  },
  car: {
    tires: true,
    suspension: true,
    alignment: false,
    geometry: false,
    drivetrain: false,
    aero: false,
    notes: true,
  },
};

export function getAvailableSessionModules(vehicleType: VehicleType): SessionModuleKey[] {
  return availableModulesByVehicle[vehicleType];
}

export function getDefaultEnabledModules(vehicleType: VehicleType): SessionEnabledModules {
  return { ...defaultEnabledByVehicle[vehicleType] };
}

export function getDefaultAdvancedVisibility(): SessionAdvancedVisibility {
  return {
    tires: false,
    alignment: false,
    geometry: false,
    drivetrain: false,
    aero: false,
  };
}

export function sanitizeEnabledModules(
  vehicleType: VehicleType,
  value?: Partial<Record<SessionModuleKey, boolean>> | null,
): SessionEnabledModules {
  const defaults = getDefaultEnabledModules(vehicleType);
  const available = new Set(getAvailableSessionModules(vehicleType));

  for (const key of allModuleKeys) {
    if (!available.has(key) && key !== 'notes') {
      defaults[key] = false;
      continue;
    }

    if (key === 'notes') {
      defaults[key] = true;
      continue;
    }

    if (typeof value?.[key] === 'boolean') {
      defaults[key] = value[key] as boolean;
    }
  }

  defaults.notes = true;
  return defaults;
}

export function sanitizeAdvancedVisibility(
  vehicleType: VehicleType,
  value?: SessionAdvancedVisibility | null,
): SessionAdvancedVisibility {
  const defaults = getDefaultAdvancedVisibility();
  const available = new Set(getAvailableSessionModules(vehicleType));

  for (const [key, enabled] of Object.entries(value ?? {})) {
    if (key === 'notes' || !available.has(key as SessionModuleKey)) continue;
    defaults[key as SessionModuleKey] = Boolean(enabled);
  }

  return defaults;
}

export function hasAlignmentValues(alignment: Alignment | null | undefined): boolean {
  if (!alignment) return false;
  return Object.values(alignment).some((value) => Boolean(value?.trim()));
}

function hasExtraModuleValues(extraModules: ExtraModules | null | undefined, key: keyof ExtraModules): boolean {
  const moduleValue = extraModules?.[key];
  if (!moduleValue) return false;
  return Object.values(moduleValue).some((value) => Boolean(value?.trim()));
}

function hasTireValues(session: Session): boolean {
  return [
    session.tires.front.brand,
    session.tires.front.compound,
    session.tires.front.pressure,
    session.tires.rear.brand,
    session.tires.rear.compound,
    session.tires.rear.pressure,
  ].some((value) => Boolean(value?.trim()));
}

function hasSuspensionValues(session: Session): boolean {
  return [
    session.suspension.front.preload,
    session.suspension.front.compression,
    session.suspension.front.rebound,
    session.suspension.rear.preload,
    session.suspension.rear.compression,
    session.suspension.rear.rebound,
  ].some((value) => Boolean(value?.trim()));
}

export function resolveSessionEnabledModules(
  session: Session,
  vehicleType: VehicleType,
): SessionEnabledModules {
  const stored = session.enabled_modules;
  if (stored) {
    return sanitizeEnabledModules(vehicleType, stored);
  }

  const defaults = getDefaultEnabledModules(vehicleType);
  defaults.tires = hasTireValues(session) || defaults.tires;
  defaults.suspension = hasSuspensionValues(session) || defaults.suspension;
  defaults.alignment = vehicleType === 'car' && hasAlignmentValues(session.alignment);
  defaults.geometry = vehicleType === 'motorcycle' && hasExtraModuleValues(session.extra_modules, 'geometry');
  defaults.drivetrain =
    vehicleType === 'motorcycle' && hasExtraModuleValues(session.extra_modules, 'drivetrain');
  defaults.aero = vehicleType === 'car' && hasExtraModuleValues(session.extra_modules, 'aero');
  defaults.notes = Boolean(session.notes?.trim());

  return defaults;
}
