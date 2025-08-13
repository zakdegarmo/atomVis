
import type { MoleculeData } from '../types';

/**
 * A dictionary of known molecules and their bonding structures.
 * The key is a string signature of the molecule, created by joining the atomic symbols
 * in the order they are selected by the user.
 * For these structures to apply, users should select the central atom first.
 */
export const knownMolecules: MoleculeData = {
    // Water: O-H-H. O is index 0.
    'OHH': { 
        name: 'Water',
        pairs: [
            { pair: [0, 1], type: 1 }, 
            { pair: [0, 2], type: 1 }
        ] 
    },
    // Methane: C-H-H-H-H. C is index 0.
    'CHHHH': { 
        name: 'Methane',
        pairs: [
            { pair: [0, 1], type: 1 }, 
            { pair: [0, 2], type: 1 }, 
            { pair: [0, 3], type: 1 }, 
            { pair: [0, 4], type: 1 }
        ] 
    },
    // Ammonia: N-H-H-H. N is index 0.
    'NHHH': {
        name: 'Ammonia',
        pairs: [
            { pair: [0, 1], type: 1 }, 
            { pair: [0, 2], type: 1 }, 
            { pair: [0, 3], type: 1 }
        ]
    },
    // Carbon Dioxide: C-O-O. C is index 0. Two C=O double bonds.
    'COO': {
        name: 'Carbon Dioxide',
        pairs: [
            { pair: [0, 1], type: 2 }, 
            { pair: [0, 2], type: 2 }
        ]
    },
    // Ethene: C-C-H-H-H-H. One C=C double bond.
    'CCHHHH': {
        name: 'Ethene',
        // C(0)=C(1), C(0)-H(2), C(0)-H(3). C(1)-H(4), C(1)-H(5).
        pairs: [
            { pair: [0, 1], type: 2 }, 
            { pair: [0, 2], type: 1 }, 
            { pair: [0, 3], type: 1 }, 
            { pair: [1, 4], type: 1 }, 
            { pair: [1, 5], type: 1 }
        ]
    },
    // Hydrogen Peroxide: O-O-H-H. Central O-O bond.
    'OOHH': {
        name: 'Hydrogen Peroxide',
        pairs: [
            { pair: [0, 1], type: 1 }, 
            { pair: [0, 2], type: 1 }, 
            { pair: [1, 3], type: 1 }
        ]
    },
    // Acetylene H-C≡C-H
    'HCCH': {
        name: 'Acetylene',
        pairs: [
            { pair: [0, 1], type: 1 },
            { pair: [1, 2], type: 3 },
            { pair: [2, 3], type: 1 }
        ]
    },
    // Dinitrogen N≡N
    'NN': {
        name: 'Dinitrogen',
        pairs: [
            { pair: [0, 1], type: 3 }
        ]
    },
    // Ethanol from formula C2H5OH -> ['C', 'C', 'H', 'H', 'H', 'H', 'H', 'O', 'H']
    'CCHHHHHOH': {
        name: 'Ethanol',
        // C(0)-C(1), C(0)-H(2), C(0)-H(3), C(0)-H(4)
        // C(1)-H(5), C(1)-H(6), C(1)-O(7)
        // O(7)-H(8)
        pairs: [
            { pair: [0, 1], type: 1 }, { pair: [0, 2], type: 1 }, { pair: [0, 3], type: 1 }, 
            { pair: [0, 4], type: 1 }, { pair: [1, 5], type: 1 }, { pair: [1, 6], type: 1 }, 
            { pair: [1, 7], type: 1 }, { pair: [7, 8], type: 1 }
        ]
    },
    // Ethanol from structural formula CH3.CH2.OH -> ['C', 'H', 'H', 'H', 'C', 'H', 'H', 'O', 'H']
    'CHHHCHHOH': {
        name: 'Ethanol',
        // C(0)-H(1), C(0)-H(2), C(0)-H(3) and C(0)-C(4)
        // C(4)-H(5), C(4)-H(6) and C(4)-O(7)
        // O(7)-H(8)
        pairs: [
            { pair: [0, 1], type: 1 }, { pair: [0, 2], type: 1 }, { pair: [0, 3], type: 1 },
            { pair: [0, 4], type: 1 }, { pair: [4, 5], type: 1 }, { pair: [4, 6], type: 1 },
            { pair: [4, 7], type: 1 }, { pair: [7, 8], type: 1 }
        ]
    }
};
