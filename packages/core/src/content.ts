// Content types. Balance mirrors content/schemas/balance.schema.json; EventDef mirrors
// content/schemas/event.schema.json. scripts/build-content.ts validates the YAML/JSON sources
// against those schemas and writes src/generated/content.json, which is what the game loads.

import generated from './generated/content.json' with { type: 'json' };

export type StarClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';
export const STAR_CLASSES: readonly StarClass[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];

export type WorldType =
  | 'rocky'
  | 'super-earth'
  | 'ocean'
  | 'ice'
  | 'desert'
  | 'lava'
  | 'gas-giant'
  | 'ice-giant'
  | 'belt';

export type LandableWorldType = Exclude<WorldType, 'gas-giant' | 'ice-giant'>;

export type Resource = 'fuel' | 'lifeSupport' | 'hull' | 'materials' | 'data';
export type Deltas = Partial<Record<Resource, number>>;
export type Range = [number, number];
export type MineableResource = 'fuel' | 'materials' | 'lifeSupport';
export type ResourceRanges = Partial<Record<MineableResource, Range>>;

export type HazardKind = 'none' | 'flare' | 'radiation';

interface KoiWeights {
  planet: number;
  eclipsingBinary: number;
  artifact: number;
}

export interface Balance {
  jump: {
    startingRangeLy: number;
    maxRangeLy: number;
    fuelBase: number;
    fuelPerLy: number;
    fuelPerLySquared: number;
    lifeSupportPerJump: number;
  };
  ship: {
    start: { fuel: number; lifeSupport: number; hull: number; materials: number; data: number };
    max: { fuel: number; lifeSupport: number; hull: number; materials: number };
  };
  lifeSupport: { perTurn: number; perLanding: number };
  sensors: { rangeLy: number };
  front: {
    startBehindLy: number;
    speedLyPerTurn: number;
    hullDamagePerTurn: number;
    warnDistanceLy: number;
  };
  repair: { materialsPerAction: number; hullPerAction: number };
  survey: { data: number; realDataBonus: number };
  firstVisit: { hostData: number; landmarkData: number };
  mining: {
    perAction: Record<MineableResource, number>;
    hazardChance: number;
    hazardDamage: Range;
  };
  stay: {
    yieldGrowthPerTurn: number;
    hazardChanceBase: number;
    hazardChancePerTurn: number;
    hazardDamage: Range;
    clockTurns: number;
    clockPayoff: Deltas;
  };
  clocks: {
    recycler: { label: string; every: number; payoff: Deltas };
    sensorSweep: { label: string; every: number; payoff: Deltas };
    analysis: { label: string; turns: number; payoff: Deltas };
    spectrum: { label: string; turns: number; payoff: Deltas };
  };
  events: { arrivalChance: number; landingChance: number; stayChance: number };
  landing: {
    unsurveyedRiskBonus: number;
    damage: Range;
    risk: Record<LandableWorldType, number>;
  };
  stars: {
    solarTeffK: number;
    classes: { cls: StarClass; minTeff: number }[];
    defaultClass: StarClass;
    defaultTeffK: number;
    bpRpToTeff: { note: string; points: Range[] };
    typicalRadius: Record<StarClass, number>;
    hazard: Record<StarClass, { kind: HazardKind; chance: number; damage: Range }>;
  };
  generation: {
    planetCountWeights: Record<StarClass, number[]>;
    firstOrbitAu: Range;
    orbitRatio: Range;
    realOrbitClearanceRatio: number;
    beltChance: number;
    radiusEarthLogRange: Range;
    radiusSkew: number;
    koiResolution: {
      base: KoiWeights;
      flagMultipliers: {
        notTransitLike: KoiWeights;
        stellarEclipse: KoiWeights;
        centroidOffset: KoiWeights;
        ephemerisMatch: KoiWeights;
      };
      scoreWeight: number;
      resolvedData: KoiWeights;
    };
    worldTypes: {
      giantRadiusEarth: number;
      iceGiantRadiusEarth: number;
      superEarthRadiusEarth: number;
      iceGiantMaxTeqK: number;
      lavaMinTeqK: number;
      desertMinTeqK: number;
      temperateMinTeqK: number;
      oceanChanceTemperate: number;
    };
    resources: Record<WorldType, ResourceRanges>;
    temperateLifeSupport: Range;
    metallicityRichness: number;
  };
}

export type Cargo = Record<string, number>;

export interface ClockPayoff {
  deltas?: Deltas;
  cargo?: Cargo;
  revealCache?: Deltas;
  log: string;
}

export interface Outcome {
  deltas?: Deltas;
  cargo?: Cargo;
  passTurns?: number;
  liftOff?: true;
  first?: string;
  clock?: { kind: 'decode' | 'delayed'; label: string; turns: number; payoff: ClockPayoff };
  log: string;
}

export interface EventOption {
  id: string;
  label: string;
  cost?: Partial<Record<'fuel' | 'lifeSupport' | 'materials' | 'data', number>>;
  chance?: number;
  success: Outcome;
  failure?: Outcome;
}

export type EventTrigger = 'arrival' | 'landing' | 'stay';

export interface EventDef {
  id: string;
  title: string;
  trigger: EventTrigger;
  tags?: {
    firstVisit?: boolean;
    starClass?: StarClass[];
    worldTypes?: WorldType[];
    temperateWorld?: boolean;
    starHazard?: HazardKind[];
    minTurn?: number;
    once?: boolean;
  };
  weight: number;
  text: string;
  options: EventOption[];
}

export interface Content {
  version: string;
  balance: Balance;
  events: EventDef[];
}

export const defaultContent: Content = generated as unknown as Content;
