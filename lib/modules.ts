export type VehicleMode = 'motorcycle' | 'car';

export type SessionModuleType =
  | 'tires'
  | 'suspension'
  | 'geometry'
  | 'drivetrain'
  | 'alignment'
  | 'aero'
  | 'notes';

export type ModuleInputType = 'number' | 'text' | 'textarea';

export interface ModuleFieldDefinition {
  key: string;
  label: string;
  input: ModuleInputType;
  unit?: string;
  placeholder?: string;
  advanced?: boolean;
}

export interface ModuleDefinition {
  moduleType: SessionModuleType;
  label: string;
  vehicleModes: VehicleMode[];
  fields: ModuleFieldDefinition[];
}

const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    moduleType: 'tires',
    label: 'Tires',
    vehicleModes: ['motorcycle', 'car'],
    fields: [
      { key: 'front_cold', label: 'Front cold pressure', input: 'number', unit: 'psi' },
      { key: 'rear_cold', label: 'Rear cold pressure', input: 'number', unit: 'psi' },
      { key: 'front_hot', label: 'Front hot pressure', input: 'number', unit: 'psi', advanced: true },
      { key: 'rear_hot', label: 'Rear hot pressure', input: 'number', unit: 'psi', advanced: true },
      { key: 'tire_notes', label: 'Tire notes', input: 'textarea', placeholder: 'Grip, wear, warmup behavior...', advanced: true },
    ],
  },
  {
    moduleType: 'suspension',
    label: 'Suspension',
    vehicleModes: ['motorcycle', 'car'],
    fields: [
      { key: 'compression_clicks', label: 'Compression clicks', input: 'number' },
      { key: 'rebound_clicks', label: 'Rebound clicks', input: 'number' },
      { key: 'spring_rate', label: 'Spring rate', input: 'text', advanced: true },
      { key: 'ride_height_notes', label: 'Ride height notes', input: 'textarea', advanced: true },
    ],
  },
  {
    moduleType: 'geometry',
    label: 'Geometry',
    vehicleModes: ['motorcycle'],
    fields: [
      { key: 'sag_front', label: 'Front sag', input: 'number', unit: 'mm' },
      { key: 'sag_rear', label: 'Rear sag', input: 'number', unit: 'mm' },
      { key: 'fork_height', label: 'Fork height in triples', input: 'number', unit: 'mm', advanced: true },
      { key: 'geometry_notes', label: 'Geometry notes', input: 'textarea', advanced: true },
    ],
  },
  {
    moduleType: 'drivetrain',
    label: 'Drivetrain',
    vehicleModes: ['motorcycle'],
    fields: [
      { key: 'front_sprocket', label: 'Front sprocket teeth', input: 'number' },
      { key: 'rear_sprocket', label: 'Rear sprocket teeth', input: 'number' },
      { key: 'chain_notes', label: 'Chain/drivetrain notes', input: 'textarea', advanced: true },
    ],
  },
  {
    moduleType: 'alignment',
    label: 'Alignment',
    vehicleModes: ['car'],
    fields: [
      { key: 'camber_front', label: 'Front camber', input: 'text' },
      { key: 'camber_rear', label: 'Rear camber', input: 'text' },
      { key: 'toe_front', label: 'Front toe', input: 'text', advanced: true },
      { key: 'toe_rear', label: 'Rear toe', input: 'text', advanced: true },
      { key: 'caster_front', label: 'Front caster', input: 'text', advanced: true },
    ],
  },
  {
    moduleType: 'aero',
    label: 'Aero',
    vehicleModes: ['car'],
    fields: [
      { key: 'wing_angle', label: 'Wing angle', input: 'text' },
      { key: 'splitter_setting', label: 'Splitter setting', input: 'text', advanced: true },
      { key: 'aero_notes', label: 'Aero notes', input: 'textarea', advanced: true },
    ],
  },
  {
    moduleType: 'notes',
    label: 'Module Notes',
    vehicleModes: ['motorcycle', 'car'],
    fields: [
      { key: 'feel_notes', label: 'How did it feel?', input: 'textarea', placeholder: 'Push, understeer, spin, brake dive...' },
      { key: 'next_change', label: 'Next change to try', input: 'text', advanced: true },
    ],
  },
];

export interface SessionModuleDraft {
  enabled: boolean;
  showAdvanced: boolean;
  values: Record<string, string>;
}

export interface SessionDraft {
  vehicleMode: VehicleMode;
  vehicleId: string;
  trackId: string;
  sessionDate: string;
  sessionNumber: string;
  weather: string;
  temperatureF: string;
  trackCondition: string;
  notes: string;
  modules: Partial<Record<SessionModuleType, SessionModuleDraft>>;
}

export const defaultEnabledModules: Record<VehicleMode, SessionModuleType[]> = {
  motorcycle: ['tires', 'notes'],
  car: ['tires', 'notes'],
};

export function getModulesForMode(mode: VehicleMode): ModuleDefinition[] {
  return MODULE_DEFINITIONS.filter((module) => module.vehicleModes.includes(mode));
}

export function getDefaultDraft(mode: VehicleMode): SessionDraft {
  const modules = getModulesForMode(mode).reduce<Partial<Record<SessionModuleType, SessionModuleDraft>>>(
    (acc, module) => {
      acc[module.moduleType] = {
        enabled: defaultEnabledModules[mode].includes(module.moduleType),
        showAdvanced: false,
        values: {},
      };
      return acc;
    },
    {}
  );

  return {
    vehicleMode: mode,
    vehicleId: '',
    trackId: '',
    sessionDate: new Date().toISOString().slice(0, 10),
    sessionNumber: '',
    weather: '',
    temperatureF: '',
    trackCondition: '',
    notes: '',
    modules,
  };
}
