import type * as THREE from 'three';

export interface AtomImage {
  title: string;
  url: string;
  attribution: string;
}

export interface ElementInfo {
  number: number;
  name: string;
  symbol: string;
}

export interface Atom {
  name: string;
  appearance: string | null;
  atomicMass: number;
  boil: number | null;
  category: string;
  density: number | null;
  discoveredBy: string | null;
  melt: number | null;
  molarHeat: number | null;
  namedBy: string | null;
  number: number;
  period: number;
  group: number;
  phase: string;
  source: string;
  bohrModelImage: string | null;
  bohrModel3d: string | null;
  spectralImg: string | null;
  summary: string;
  symbol: string;
  xpos: number;
  ypos: number;
  wxpos: number;
  wypos: number;
  shells: number[];
  electronConfiguration: string;
  electronConfigurationSemantic: string;
  electronAffinity: number | null;
  electronegativityPauling: number | null;
  ionizationEnergies: number[];
  cpkHex: string | null;
  image: AtomImage;
  block: string;
}

export interface Bond {
    pair: [number, number];
    type: 1 | 2 | 3; // 1 for single, 2 for double, 3 for triple
}

export interface BondingData {
    name: string;
    pairs: Bond[];
}

export interface MoleculeData {
    [signature: string]: BondingData;
}

export interface MoleculeInfo {
  summary: string;
  commonUses: string[];
  funFact: string;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  atomIndex: number;
}

export interface ParsedMoleculeData {
  name: string;
  symbols: string[];
  positions: THREE.Vector3[];
  bonds: Bond[];
}