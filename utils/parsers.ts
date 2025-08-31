import * as THREE from 'three';
import type { Bond, ParsedMoleculeData } from '../types';

const covalentRadii: { [symbol: string]: number } = {
  H: 0.37, He: 0.32, Li: 1.34, Be: 0.9, B: 0.82, C: 0.77, N: 0.75, O: 0.73,
  F: 0.71, Ne: 0.69, Na: 1.54, Mg: 1.3, Al: 1.18, Si: 1.11, P: 1.06, S: 1.02,
  Cl: 0.99, Ar: 0.97, K: 1.96, Ca: 1.74, Sc: 1.44, Ti: 1.36, V: 1.25, Cr: 1.27,
  Mn: 1.39, Fe: 1.25, Co: 1.26, Ni: 1.21, Cu: 1.38, Zn: 1.31, Ga: 1.26, Ge: 1.22,
  As: 1.19, Se: 1.16, Br: 1.14, Kr: 1.1, Rb: 2.11, Sr: 1.92, Y: 1.62, Zr: 1.48,
  Nb: 1.37, Mo: 1.45, Tc: 1.56, Ru: 1.26, Rh: 1.35, Pd: 1.31, Ag: 1.53, Cd: 1.48,
  In: 1.44, Sn: 1.41, Sb: 1.38, Te: 1.35, I: 1.33, Xe: 1.3, Cs: 2.25, Ba: 1.98,
  DEFAULT: 1.0 // Default radius for unknown elements
};

/**
 * Parses molecule data from an SDF (Structure-Data File) string.
 * @param sdfData The string content of the SDF file.
 * @param name The name to assign to the parsed molecule.
 * @returns A ParsedMoleculeData object.
 */
export function parseSDF(sdfData: string, name: string): ParsedMoleculeData {
    const lines = sdfData.split('\n');
    if (lines.length < 4) throw new Error("Invalid SDF file format.");

    const countsLine = lines[3].trim().split(/\s+/);
    const atomCount = parseInt(countsLine[0], 10);
    const bondCount = parseInt(countsLine[1], 10);

    if (isNaN(atomCount) || isNaN(bondCount)) throw new Error("Could not read atom/bond counts from SDF.");
    if (atomCount > 100) throw new Error(`Molecule is too large (${atomCount} atoms). Max is 100.`);

    const symbols: string[] = [];
    const positions: THREE.Vector3[] = [];
    const bonds: Bond[] = [];
    
    // Atom block starts at line 4 (0-indexed)
    for (let i = 0; i < atomCount; i++) {
        const line = lines[4 + i];
        if (!line) continue;
        const parts = line.trim().split(/\s+/);
        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        const z = parseFloat(parts[2]);
        const symbol = parts[3];
        
        if (!isNaN(x) && !isNaN(y) && !isNaN(z) && symbol) {
            positions.push(new THREE.Vector3(x, y, z));
            symbols.push(symbol);
        }
    }

    // Bond block starts after atom block
    const bondBlockStart = 4 + atomCount;
    for (let i = 0; i < bondCount; i++) {
        const line = lines[bondBlockStart + i];
        if (!line) continue;
        const parts = line.trim().split(/\s+/);
        const from = parseInt(parts[0], 10) - 1; // SDF is 1-indexed
        const to = parseInt(parts[1], 10) - 1;
        const type = parseInt(parts[2], 10) as 1 | 2 | 3;
        
        if (!isNaN(from) && !isNaN(to) && [1, 2, 3].includes(type)) {
            bonds.push({ pair: [Math.min(from, to), Math.max(from, to)], type });
        }
    }
    
    return { name, symbols, positions, bonds };
}

/**
 * Parses molecule data from a PDB (Protein Data Bank) file string.
 * Infers bonds based on atomic distances if CONECT records are not present.
 * @param pdbData The string content of the PDB file.
 * @param name The name to assign to the parsed molecule.
 * @returns A ParsedMoleculeData object.
 */
export function parsePDB(pdbData: string, name: string): ParsedMoleculeData {
    const lines = pdbData.split('\n');
    const atomLines = lines.filter(line => line.startsWith('ATOM') || line.startsWith('HETATM'));
    const PDB_MAX_ATOMS = 500;
    
    if(atomLines.length > PDB_MAX_ATOMS) {
        throw new Error(`Molecule is too large (${atomLines.length} atoms). Max for PDB is ${PDB_MAX_ATOMS}.`);
    }

    const symbols: string[] = [];
    const positions: THREE.Vector3[] = [];
    const atomMap = new Map<number, number>(); // Maps PDB serial to our 0-based index

    atomLines.forEach((line, index) => {
        const x = parseFloat(line.substring(30, 38));
        const y = parseFloat(line.substring(38, 46));
        const z = parseFloat(line.substring(46, 54));
        const symbol = line.substring(76, 78).trim().toUpperCase() || line.substring(12, 16).trim().charAt(0).toUpperCase();
        const serial = parseInt(line.substring(6, 11), 10);
        
        if (!isNaN(x) && !isNaN(y) && !isNaN(z) && symbol) {
            positions.push(new THREE.Vector3(x, y, z));
            symbols.push(symbol);
            atomMap.set(serial, index);
        }
    });

    // --- Bond parsing ---
    const bonds: Bond[] = [];
    const bondSet = new Set<string>(); // To avoid duplicate bonds
    
    // First, try using CONECT records for explicit bonds
    const conectLines = lines.filter(line => line.startsWith('CONECT'));
    if (conectLines.length > 0) {
        conectLines.forEach(line => {
            const parts = line.trim().split(/\s+/).slice(1).map(p => parseInt(p, 10));
            const fromSerial = parts[0];
            const fromIndex = atomMap.get(fromSerial);
            
            if (fromIndex !== undefined) {
                for (let i = 1; i < parts.length; i++) {
                    const toSerial = parts[i];
                    const toIndex = atomMap.get(toSerial);
                    if (toIndex !== undefined) {
                        const pair = [Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex)];
                        const bondKey = `${pair[0]}-${pair[1]}`;
                        if(!bondSet.has(bondKey)) {
                            bonds.push({ pair: [pair[0], pair[1]], type: 1 }); // Assume single bonds from CONECT
                            bondSet.add(bondKey);
                        }
                    }
                }
            }
        });
    }

    // If no CONECT records were found or they were incomplete, infer bonds from distance
    if (bonds.length === 0 && atomLines.length > 1) {
        const bondTolerance = 0.45;
        for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
                const r1 = covalentRadii[symbols[i]] || covalentRadii.DEFAULT;
                const r2 = covalentRadii[symbols[j]] || covalentRadii.DEFAULT;
                const maxDist = r1 + r2 + bondTolerance;
                
                if (positions[i].distanceTo(positions[j]) < maxDist) {
                    bonds.push({ pair: [i, j], type: 1 });
                }
            }
        }
    }

    return { name, symbols, positions, bonds };
}
