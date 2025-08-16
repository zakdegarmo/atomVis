import React, { useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { GoogleGenAI, Type } from '@google/genai';
import type { Atom, ElementInfo, MoleculeInfo, ContextMenuState, Bond } from './types';
import AtomSelector from './components/AtomSelector';
import AtomViewer from './components/AtomViewer';
import { GithubIcon } from './components/Icons';
import { knownMolecules } from './data/molecules';
import MoleculeInfoCard from './components/MoleculeInfoCard';
import ContextMenu from './components/ContextMenu';

// --- Helper Functions ---

/**
 * Calculates a representative "visual radius" for an atom for use in spacing calculations.
 * This is based on shell count and atomic mass.
 */
function getAtomVisualRadius(atom: Atom): number {
    const NUCLEUS_SCALE_FACTOR = 0.3;
    const SHELL_BASE_RADIUS = 2.5;
    const SHELL_SPACING = 1.8;
    const massScale = Math.max(0.5, Math.cbrt(atom.atomicMass) * NUCLEUS_SCALE_FACTOR);
    const shellRadius = atom.shells.length > 0
        ? SHELL_BASE_RADIUS + (atom.shells.length - 1) * SHELL_SPACING
        : SHELL_BASE_RADIUS;
    return shellRadius * massScale;
}

/**
 * Generates points on a sphere for distributing objects evenly using the golden angle.
 */
function getSpherePoints(samples: number, radius: number): THREE.Vector3[] {
    if (samples <= 0) return [];
    if (samples === 1) return [new THREE.Vector3(0, radius, 0)];

    const points: THREE.Vector3[] = [];
    const phi = Math.PI * (3 - Math.sqrt(5)); // Golden angle

    for (let i = 0; i < samples; i++) {
        const y = 1 - (i / (samples - 1)) * 2; // y goes from 1 to -1
        const r = Math.sqrt(1 - y * y);
        const theta = phi * i;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        points.push(new THREE.Vector3(x, y, z).multiplyScalar(radius));
    }
    return points;
}


const App: React.FC = () => {
  const [elementList, setElementList] = useState<ElementInfo[]>([]);
  const [totalAtoms, setTotalAtoms] = useState<number>(4);
  const [atomSymbols, setAtomSymbols] = useState<string[]>(['C', 'H', 'H', 'H']);
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [atomPositions, setAtomPositions] = useState<THREE.Vector3[]>([]);
  const [bondingPairs, setBondingPairs] = useState<Bond[]>([]);
  const [moleculeName, setMoleculeName] = useState<string | null>(null);
  const [electronSpeed, setElectronSpeed] = useState<number>(0.2);
  const [bondingProgress, setBondingProgress] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Quantum mode toggle (secondary/fun feature)
  const [quantumMode, setQuantumMode] = useState<boolean>(false);

  // State for Gemini feature
  const [showInfoCard, setShowInfoCard] = useState<boolean>(false);
  const [moleculeInfo, setMoleculeInfo] = useState<MoleculeInfo | null>(null);
  const [isInfoLoading, setIsInfoLoading] = useState<boolean>(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  // State for formula input
  const [formula, setFormula] = useState<string>('CH3.CH2.OH');
  const [formulaError, setFormulaError] = useState<string | null>(null);

  // State for context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    atomIndex: 0,
  });

  // Effect to fetch the element list for dropdowns
  useEffect(() => {
    fetch('/data/elements.json')
      .then(res => res.json())
      .then(data => setElementList(data.elements))
      .catch(error => console.error("Failed to load element list:", error));
  }, []);

  // Adjust atom symbol array when totalAtoms changes
  useEffect(() => {
    setAtomSymbols(currentSymbols => {
      const newSize = totalAtoms;
      const currentSize = currentSymbols.length;
      if (newSize > currentSize) {
        return [...currentSymbols, ...Array(newSize - currentSize).fill('H')];
      }
      if (newSize < currentSize) {
        return currentSymbols.slice(0, newSize);
      }
      return currentSymbols;
    });
    // Reset bonding when the number of atoms changes
    setBondingPairs([]);
    setBondingProgress(0);
  }, [totalAtoms]);

  const handleAtomChange = useCallback((index: number, symbol: string) => {
    setAtomSymbols(currentSymbols => {
      const newSymbols = [...currentSymbols];
      newSymbols[index] = symbol;
      return newSymbols;
    });
    // Reset bonding when an atom type changes
    setBondingPairs([]);
    setBondingProgress(0);
  }, []);
  
  const handleAtomPositionChange = useCallback((index: number, position: THREE.Vector3) => {
    setAtomPositions(currentPositions => {
        const newPositions = [...currentPositions];
        newPositions[index] = position.clone();
        return newPositions;
    });
  }, []);

  // Utility to fetch and process atom data
  const fetchAtomData = useCallback((symbol: string, elementList: ElementInfo[]): Promise<Atom | null> => {
      const elementInfo = elementList.find(el => el.symbol === symbol);
      if (!elementInfo) {
          console.error(`Could not find info for symbol ${symbol}`);
          return Promise.resolve(null);
      }
      const elementName = elementInfo.name;

      const snakeToCamel = (str: string) => str.replace(/([-_][a-z])/g, group => group.toUpperCase().replace('-', '').replace('_', ''));
      const convertKeysToCamelCase = (obj: any): any => {
          if (Array.isArray(obj)) return obj.map(v => convertKeysToCamelCase(v));
          if (obj !== null && obj.constructor === Object) {
              return Object.keys(obj).reduce((acc: {[key: string]: any}, key: string) => {
                  const camelKey = key === 'cpk-hex' ? 'cpkHex' : snakeToCamel(key);
                  acc[camelKey] = convertKeysToCamelCase(obj[key]);
                  return acc;
              }, {});
          }
          return obj;
      };

      return fetch(`/${elementName}.json`)
        .then(res => {
          if (!res.ok) throw new Error(`Data for ${elementName} not found. Status: ${res.status}`);
          return res.json();
        })
        .then(data => convertKeysToCamelCase(data) as Atom)
        .catch(error => {
          console.error(`Failed to load data for ${elementName}:`, error);
          return null;
        });
  }, []);

    // Handler for getting AI-powered molecule info
    const handleGetInfoClick = useCallback(async () => {
        if (!moleculeName) return;

        setShowInfoCard(true);
        setIsInfoLoading(true);
        setInfoError(null);
        setMoleculeInfo(null);

        try {
            if (!process.env.API_KEY) {
                throw new Error("API key is not configured. Please set the API_KEY environment variable.");
            }
            const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

            const schema = {
                type: Type.OBJECT,
                properties: {
                    summary: {
                        type: Type.STRING,
                        description: "A brief, easy-to-understand summary of the molecule."
                    },
                    commonUses: {
                        type: Type.ARRAY,
                        description: "A list of common uses for the molecule.",
                        items: { type: Type.STRING }
                    },
                    funFact: {
                        type: Type.STRING,
                        description: "An interesting and fun fact about the molecule."
                    }
                },
                required: ["summary", "commonUses", "funFact"]
            };

            const prompt = `Provide a concise and interesting summary for the molecule: ${moleculeName}. The summary should be easy for a high school student to understand. Also, list its most common uses and include one fun fact.`;

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: schema,
                },
            });
            
            const info = JSON.parse(response.text) as MoleculeInfo;
            setMoleculeInfo(info);

        } catch (error) {
            console.error("Failed to fetch molecule info:", error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
            setInfoError(`Sorry, I couldn't fetch information for ${moleculeName}. ${errorMessage}`);
        } finally {
            setIsInfoLoading(false);
        }
    }, [moleculeName]);

    // Handler for creating atoms from a formula string
    const handleFormulaCreate = useCallback(() => {
        setFormulaError(null);
        if (elementList.length === 0) {
            setFormulaError("Element data is still loading. Please try again in a moment.");
            return;
        }
        if (!formula.trim()) {
            setFormulaError("Formula cannot be empty.");
            return;
        }

        const elementSymbolMap = new Map(elementList.map(el => [el.symbol.toLowerCase(), el.symbol]));
        
        const parts = formula.replace(/\s/g, '').split('.');
        const newSymbols: string[] = [];

        for (const part of parts) {
            if (part === '') continue; // Allows for trailing dots, e.g., "CH3."

            const regex = /([A-Z][a-z]?)(\d*)/g;
            let match;
            let lastIndex = 0;

            while ((match = regex.exec(part)) !== null) {
                const symbolCase = match[1].toLowerCase();
                const normalizedSymbol = elementSymbolMap.get(symbolCase);
                
                if (!normalizedSymbol) {
                    setFormulaError(`Invalid element symbol: "${match[1]}".`);
                    return;
                }

                const count = match[2] ? parseInt(match[2], 10) : 1;
                if (isNaN(count) || count < 1) {
                    setFormulaError(`Invalid count for element "${normalizedSymbol}".`);
                    return;
                }
                
                for (let i = 0; i < count; i++) {
                    newSymbols.push(normalizedSymbol as string);
                }
                lastIndex = regex.lastIndex;
            }
            
            if (lastIndex !== part.length) {
                setFormulaError(`Invalid format in part "${part}". Use formats like 'C2H6O' or 'CH3.CH2.OH'.`);
                return;
            }
        }
        
        if (newSymbols.length === 0) {
            setFormulaError("Formula did not yield any atoms.");
            return;
        }
        if (newSymbols.length > 100) {
            setFormulaError(`Cannot create more than 100 atoms (formula has ${newSymbols.length}).`);
            return;
        }

        setAtomSymbols(newSymbols);
        setTotalAtoms(newSymbols.length);
    }, [elementList, formula]);

  // Effect to load data for all selected atoms and determine bonding structure
  useEffect(() => {
    if (elementList.length === 0 || atomSymbols.length === 0) return;
    setIsLoading(true);
    Promise.all(atomSymbols.map(symbol => fetchAtomData(symbol, elementList)))
      .then(fetchedAtoms => {
        // Filter out any nulls from failed fetches
        const validAtoms = fetchedAtoms.filter((atom): atom is Atom => atom !== null);
        if (validAtoms.length !== atomSymbols.length) {
            setIsLoading(false);
            return;
        }
        setAtoms(validAtoms);
        // Determine bonding structure
        const signature = atomSymbols.join('');
        const moleculeData = knownMolecules[signature];
        let newBondingPairs: Bond[] = [];
        if (moleculeData) {
            setMoleculeName(moleculeData.name);
            newBondingPairs = moleculeData.pairs;
        } else {
            setMoleculeName(null);
        }
        setBondingPairs(newBondingPairs);
        setBondingProgress(newBondingPairs.length > 0 ? 1 : 0);
        // Loading state is turned off by AtomViewer after rendering is complete
      });
  }, [atomSymbols, elementList, fetchAtomData]);

  // --- Proximity-based Atom Placement (bondingProgress controls distance) ---
  useEffect(() => {
    function getFibonacciSpherePoints(samples: number, radius: number): THREE.Vector3[] {
      if (samples <= 0) return [];
      if (samples === 1) return [new THREE.Vector3(0, 0, 0)];
      let points = [];
      const phi = Math.PI * (3. - Math.sqrt(5.));
      for (let i = 0; i < samples; i++) {
          const y = 1 - (i / (samples - 1)) * 2;
          const r = Math.sqrt(1 - y * y);
          points.push(new THREE.Vector3(Math.cos(phi * i) * r * radius, y * radius, Math.sin(phi * i) * r * radius));
      }
      return points;
    }
    const atomCount = atoms.length;
    const baseRadius = 15;
    const minRadius = 2.5;
    let newPositions: THREE.Vector3[] = [];
    if (atomCount > 0) {
      const bondRadius = baseRadius - (baseRadius - minRadius) * (bondingProgress || 0);
      newPositions = getFibonacciSpherePoints(atomCount, bondRadius);
    }
    setAtomPositions(newPositions);
  }, [atoms, bondingProgress]);
  
  // Auto-build on first load when element list is ready
  useEffect(() => {
    if (elementList.length > 0) {
      handleFormulaCreate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementList]);

  // --- Context Menu Handlers ---
  const handleAtomRightClick = useCallback((atomIndex: number, x: number, y: number) => {
    setContextMenu({ visible: true, x, y, atomIndex });
  }, []);
  
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  const handleAddBond = useCallback((fromIndex: number, toIndex: number, type: 1 | 2 | 3) => {
    setBondingPairs(currentBonds => {
        const newPair = [fromIndex, toIndex].sort((a,b) => a - b) as [number, number];
        const exists = currentBonds.some(b => b.pair[0] === newPair[0] && b.pair[1] === newPair[1]);
        if (!exists) {
            return [...currentBonds, { pair: newPair, type }];
        }
        return currentBonds;
    });
    handleCloseContextMenu();
  }, [handleCloseContextMenu]);

  const handleRemoveBonds = useCallback((atomIndex: number) => {
    setBondingPairs(currentBonds => {
      const newBonds = currentBonds.filter(bond => !bond.pair.includes(atomIndex));
      if (newBonds.length === 0) {
        setBondingProgress(0);
      }
      return newBonds;
    });
    handleCloseContextMenu();
  }, [handleCloseContextMenu]);


  // Determine dynamic classes for layout based on the number of atoms
  const panelMaxWidthClass = totalAtoms > 30 ? 'max-w-2xl' : totalAtoms > 10 ? 'max-w-lg' : 'max-w-sm';
  const atomGridColsClass = totalAtoms > 30 ? 'grid-cols-4' : totalAtoms > 10 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div className="w-full h-full flex flex-col bg-gray-900 font-sans relative" onClick={handleCloseContextMenu}>
      <div id="info-panel" className={`absolute top-4 left-4 bg-gray-900/80 p-5 rounded-xl border border-gray-700 w-full ${panelMaxWidthClass} backdrop-blur-md z-10 shadow-lg transition-all duration-300`}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wider">
              Molecular Virtual Lab
            </h1>
            <p className="text-sm text-gray-400">Compose molecules and visualize chemical bonds.</p>
          </div>
          <a href="https://github.com/google/generative-ai-docs/tree/main/app-client-js" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors flex-shrink-0 ml-4">
            <GithubIcon className="w-7 h-7" />
          </a>
        </div>
        
        <div className="space-y-4">
            <div id="molecule-composer" className="p-3 bg-gray-800/70 rounded-md border border-gray-600 space-y-3">
                 <div className="flex justify-between items-center border-b border-gray-600 pb-2 mb-2">
                    <h2 className="text-lg font-semibold text-blue-300">
                        Molecule Composer
                        {moleculeName && <span className="ml-2 text-base font-normal text-gray-300">({moleculeName})</span>}
                    </h2>
                    {moleculeName && (
                        <button 
                            onClick={handleGetInfoClick}
                            className="ml-auto px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-full hover:bg-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 disabled:bg-blue-800/50 disabled:cursor-wait"
                            disabled={isInfoLoading}
                        >
                           {isInfoLoading ? '...' : 'Get Info'}
                        </button>
                    )}
                </div>
                
                <div className="space-y-2">
                    <label htmlFor="formula-input" className="text-sm font-medium text-gray-300">Build from Formula</label>
                    <div className="flex space-x-2">
                        <input
                            type="text"
                            id="formula-input"
                            placeholder="e.g., H2O or CH3.CH2.OH"
                            value={formula}
                            onChange={(e) => {
                                setFormula(e.target.value);
                                if (formulaError) setFormulaError(null);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleFormulaCreate(); }}
                            className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                        />
                        <button
                            onClick={handleFormulaCreate}
                            className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-lg hover:bg-green-500 transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75"
                        >
                            Build
                        </button>
                    </div>
                    {formulaError && <p className="text-red-400 text-xs mt-1">{formulaError}</p>}
                    <p className="text-xs text-gray-500">Tip: Use '.' to delineate chained parts of a molecule, e.g. CH3.CH2.OH.</p>
                </div>
                
                <div className="border-b border-gray-600/50 my-3"></div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                      <label htmlFor="total-atoms-slider" className="text-sm font-medium text-gray-300">Total Atoms</label>
                      <span className="font-bold text-blue-400 text-lg">{totalAtoms}</span>
                  </div>
                  <input type="range" id="total-atoms-slider" min="1" max="100" value={totalAtoms} onChange={(e) => setTotalAtoms(parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                </div>
                <div className={`grid ${atomGridColsClass} gap-x-4 gap-y-2 max-h-[40vh] overflow-y-auto pr-2`}>
                  {atomSymbols.map((symbol, index) => (
                    <div key={index}>
                      <label htmlFor={`atom-selector-${index}`} className="block mb-1 text-xs font-medium text-gray-400">Atom {index + 1}</label>
                      <AtomSelector 
                        id={`atom-selector-${index}`}
                        elements={elementList} 
                        selectedSymbol={symbol}
                        index={index}
                        onAtomChange={handleAtomChange} 
                      />
                    </div>
                  ))}
                </div>
            </div>

            <div className="p-3 bg-gray-800/70 rounded-md border border-gray-600 space-y-3">
                <h2 className="text-lg font-semibold text-teal-300 border-b border-gray-600 pb-2 mb-2">
                    Visualization Controls
                </h2>
                <div>
                  <div className="flex justify-between items-center mb-1">
                      <label htmlFor="bonding-slider" className="text-sm font-medium text-gray-300">Bonding Process</label>
                      <span className="font-bold text-teal-400 text-lg">{(bondingProgress * 100).toFixed(0)}%</span>
                  </div>
                  <input 
                    type="range" 
                    id="bonding-slider" 
                    min="0" max="1" 
                    step="0.01" 
                    value={bondingProgress} 
                    onChange={(e) => setBondingProgress(parseFloat(e.target.value))} 
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-teal-500 disabled:accent-gray-600 disabled:cursor-not-allowed"
                    disabled={bondingPairs.length === 0}
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                      <label htmlFor="speed-slider" className="text-sm font-medium text-gray-300">Electron Speed</label>
                      <span className="font-bold text-purple-400 text-lg">{(electronSpeed * 100).toFixed(0)}%</span>
                  </div>
                  <input type="range" id="speed-slider" min="0" max="1" step="0.01" value={electronSpeed} onChange={(e) => setElectronSpeed(parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500" />
                </div>
                <div className="flex items-center mt-4">
                  <input
                    type="checkbox"
                    id="quantum-mode-toggle"
                    checked={quantumMode}
                    onChange={() => setQuantumMode(q => !q)}
                    className="accent-cyan-500 mr-2 w-5 h-5 cursor-pointer"
                  />
                  <label htmlFor="quantum-mode-toggle" className="text-base text-cyan-300 cursor-pointer select-none font-semibold flex items-center">
                    Quantum Cloud Mode
                    <span className="ml-2 px-2 py-0.5 bg-cyan-700 text-xs rounded-full animate-pulse">NEW</span>
                    <span className="ml-2 text-xs text-gray-400">(see electron clouds!)</span>
                  </label>
                </div>
            </div>
        </div>
      </div>

      <main className="flex-grow w-full h-full">
        <AtomViewer
          atoms={atoms}
          atomPositions={atomPositions}
          onAtomPositionChange={handleAtomPositionChange}
          bondingPairs={bondingPairs}
          bondingProgress={bondingProgress}
          electronSpeed={electronSpeed}
          setIsLoading={setIsLoading}
          onAtomRightClick={handleAtomRightClick}
          quantumMode={quantumMode}
        />
      </main>

      {/* ContextMenu rendering - fixed props */}
      {contextMenu.visible && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          atomIndex={contextMenu.atomIndex}
          atoms={atoms}
          bondingPairs={bondingPairs}
          onClose={handleCloseContextMenu}
          onAddBond={handleAddBond}
          onRemoveBonds={handleRemoveBonds}
        />
      )}



      <footer className="absolute bottom-0 left-0 right-0 p-2 text-center text-xs text-gray-500 z-10 bg-gray-900/50">
        <p>Use your mouse to orbit (left-click & drag), zoom (scroll), and pan (right-click & drag).</p>
        <p className="mt-1">Right-click an atom to manage its bonds. Drag atoms to reposition them.</p>
      </footer>
    </div>
  );
};

export default App;
