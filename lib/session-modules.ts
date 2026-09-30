import { hasLoggedSetupValues } from '@/lib/stored-session';
import type {
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
    suspension: false,
    alignment: false,
    geometry: false,
    drivetrain: false,
    aero: false,
    notes: false,
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

export function resolveSessionEnabledModules(
  session: Session,
  vehicleType: VehicleType,
): SessionEnabledModules {
  const stored = session.enabled_modules;
  if (stored) {
    return sanitizeEnabledModules(vehicleType, stored);
  }

  const defaults = getDefaultEnabledModules(vehicleType);
  defaults.tires = hasLoggedSetupValues(session, 'tires') || defaults.tires;
  defaults.suspension = hasLoggedSetupValues(session, 'suspension') || defaults.suspension;
  defaults.alignment = vehicleType === 'car' && hasLoggedSetupValues(session, 'alignment');
  defaults.geometry = vehicleType === 'motorcycle' && hasLoggedSetupValues(session, 'geometry');
  defaults.drivetrain = vehicleType === 'motorcycle' && hasLoggedSetupValues(session, 'drivetrain');
  defaults.aero = vehicleType === 'car' && hasLoggedSetupValues(session, 'aero');
  defaults.notes = Boolean(session.notes?.trim());

  return defaults;
}
