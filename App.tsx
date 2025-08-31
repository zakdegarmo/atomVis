
import React, { useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { GoogleGenAI, Type } from '@google/genai';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { Atom, ElementInfo, MoleculeInfo, ContextMenuState, Bond, ParsedMoleculeData } from './types';
import AtomSelector from './components/AtomSelector';
import AtomViewer from './components/AtomViewer';
import { GithubIcon } from './components/Icons';
import { knownMolecules } from './data/molecules';
import MoleculeInfoCard from './components/MoleculeInfoCard';
import ContextMenu from './components/ContextMenu';
import DatabaseSearch from './components/DatabaseSearch';

// --- Helper Functions ---

/**
 * Triggers a browser download for a Blob.
 */
function triggerDownload(blob: Blob, fileName: string) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;

    // Append to body, click, and remove
    document.body.appendChild(link);
    link.click();

    // Clean up after the download has been initiated
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }, 100);
}


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
  const [speedInputValue, setSpeedInputValue] = useState<string>('20');
  const [isSlowMotion, setIsSlowMotion] = useState<boolean>(false);
  const [previousElectronSpeed, setPreviousElectronSpeed] = useState<number>(0.2);
  const [bondingProgress, setBondingProgress] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [visualizationMode, setVisualizationMode] = useState<'bohr' | 'quantum'>('bohr');
  const [trailLength, setTrailLength] = useState<number>(15);
  const [trailOpacity, setTrailOpacity] = useState<number>(1.0);

  // State for Gemini feature
  const [showInfoCard, setShowInfoCard] = useState<boolean>(false);
  const [moleculeInfo, setMoleculeInfo] = useState<MoleculeInfo | null>(null);
  const [isInfoLoading, setIsInfoLoading] = useState<boolean>(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  // State for formula input
  const [formula, setFormula] = useState<string>('Aspirin');
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
    fetch('./data/elements.json')
      .then(res => res.json())
      .then(data => setElementList(data.elements))
      .catch(error => console.error("Failed to load element list:", error));
  }, []);

  // Sync speed input box with electronSpeed state
  useEffect(() => {
    const percentageString = (electronSpeed * 100).toFixed(
        isSlowMotion && electronSpeed * 100 < 1 ? 2 : 0
    );
    setSpeedInputValue(percentageString);
  }, [electronSpeed, isSlowMotion]);

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

      return fetch(`./data/elements/${elementName}.json`)
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
                    newSymbols.push(normalizedSymbol);
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

    const handleLoadMoleculeFromData = useCallback((data: ParsedMoleculeData | null) => {
        if (!data || data.symbols.length === 0) {
            setFormulaError("Could not parse molecule data from the database.");
            return;
        }

        // --- Center and Scale Molecule ---
        const positions = data.positions;
        if(positions.length === 0) return;

        const boundingBox = new THREE.Box3().setFromPoints(positions);
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);
        
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const desiredSize = 25.0; // Target size for the viewer
        const scale = maxDim > 0 ? desiredSize / maxDim : 1;

        const centeredPositions = positions.map(p => 
            p.clone().sub(center).multiplyScalar(scale)
        );

        setAtomSymbols(data.symbols);
        setTotalAtoms(data.symbols.length);
        setBondingPairs(data.bonds);
        setAtomPositions(centeredPositions);
        setMoleculeName(data.name);
        setFormula(data.name); // update formula input as well
        setBondingProgress(data.bonds.length > 0 ? 1 : 0);
    }, []);

    const handleExportJSON = useCallback(() => {
        if (atoms.length === 0) {
            alert("There is no molecule to export.");
            return;
        }

        const baseName = (moleculeName || 'Molecule').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const finalFileName = `${baseName}.json`;

        const exportData = {
            name: moleculeName || 'Custom Molecule',
            atoms: atomSymbols.map((symbol, index) => ({
                symbol: symbol,
                position: atomPositions[index] ? [atomPositions[index].x, atomPositions[index].y, atomPositions[index].z] : [0, 0, 0],
            })),
            bonds: bondingPairs
        };

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        
        triggerDownload(blob, finalFileName);

    }, [atoms, atomSymbols, atomPositions, bondingPairs, moleculeName]);

    const handleExportGLTF = useCallback(() => {
        if (atoms.length === 0) {
            alert("There is no molecule to export.");
            return;
        }
        
        const baseName = (moleculeName || 'Molecule').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const finalFileName = `${baseName}.glb`;

        const exporter = new GLTFExporter();
        const exportGroup = new THREE.Group();

        // --- Constants for geometry ---
        const NUCLEUS_SCALE_FACTOR = 0.3;
        const BOND_RADIUS = 0.15;
        const DOUBLE_BOND_SPACING = 0.35;
        const TRIPLE_BOND_SPACING = 0.35;
        const ELECTRON_SIZE = 0.08;
        const SHELL_BASE_RADIUS = 2.5;
        const SHELL_SPACING = 1.8;
        
        // --- Shared materials and geometries for efficiency ---
        const electronMaterial = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.6 });
        const electronGeometry = new THREE.SphereGeometry(ELECTRON_SIZE, 16, 16);
        const bondMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.2, roughness: 0.5 });
        const bondGeometry = new THREE.CylinderGeometry(BOND_RADIUS, BOND_RADIUS, 1, 12);

        // --- Add atom and electron meshes ---
        atoms.forEach((atom, index) => {
            const atomCenter = atomPositions[index];
            if (!atomCenter) return;
            
            const atomScale = Math.max(0.5, Math.cbrt(atom.atomicMass) * NUCLEUS_SCALE_FACTOR);
            
            // Nucleus
            const geometry = new THREE.SphereGeometry(atomScale, 32, 16);
            const color = `#${atom.cpkHex || 'cccccc'}`;
            const material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(color),
                metalness: 0.1,
                roughness: 0.7,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(atomCenter);
            exportGroup.add(mesh);
            
            // Electrons (Bohr model representation)
            atom.shells.forEach((numElectrons, shellIndex) => {
                const shellRadius = (SHELL_BASE_RADIUS + shellIndex * SHELL_SPACING) * atomScale;
                const electronPositions = getSpherePoints(numElectrons, shellRadius);

                electronPositions.forEach(pos => {
                    const electronMesh = new THREE.Mesh(electronGeometry.clone(), electronMaterial.clone());
                    electronMesh.position.copy(atomCenter).add(pos);
                    exportGroup.add(electronMesh);
                });
            });
        });
        
        // --- Add bond meshes ---
        if (bondingPairs.length > 0) {
            const upVector = new THREE.Vector3(0, 1, 0);

            bondingPairs.forEach(bondInfo => {
                const { pair, type } = bondInfo;
                const posA = atomPositions[pair[0]];
                const posB = atomPositions[pair[1]];
                
                if (!posA || !posB) return;

                const bondGroup = new THREE.Group();
                const createBondMesh = () => new THREE.Mesh(bondGeometry.clone(), bondMaterial.clone());

                if (type === 3) {
                    const bond1 = createBondMesh();
                    bond1.position.x = -TRIPLE_BOND_SPACING;
                    const bond2 = createBondMesh();
                    const bond3 = createBondMesh();
                    bond3.position.x = TRIPLE_BOND_SPACING;
                    bondGroup.add(bond1, bond2, bond3);
                } else if (type === 2) {
                    const bond1 = createBondMesh();
                    bond1.position.x = -DOUBLE_BOND_SPACING / 2;
                    const bond2 = createBondMesh();
                    bond2.position.x = DOUBLE_BOND_SPACING / 2;
                    bondGroup.add(bond1, bond2);
                } else {
                    bondGroup.add(createBondMesh());
                }

                const distance = posA.distanceTo(posB);
                bondGroup.position.copy(posA).lerp(posB, 0.5);
                const direction = new THREE.Vector3().subVectors(posB, posA);
                bondGroup.quaternion.setFromUnitVectors(upVector, direction.clone().normalize());
                bondGroup.scale.set(1, distance, 1);
                exportGroup.add(bondGroup);
            });
        }
        
        // --- Setup and export scene ---
        const exportScene = new THREE.Scene();
        exportScene.add(exportGroup);
        exportScene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(5, 10, 7.5);
        exportScene.add(directionalLight);

        exporter.parse(exportScene, (result) => {
                if (result instanceof ArrayBuffer) {
                    const blob = new Blob([result], { type: 'model/gltf-binary' });
                    triggerDownload(blob, finalFileName);
                }
            }, (error) => {
                console.error('An error occurred during GLB export:', error);
                alert('An error occurred during GLB export. See console for details.');
            }, { binary: true }
        );

        // Dispose of geometries created specifically for the export to prevent memory leaks
        electronGeometry.dispose();
        bondGeometry.dispose();

    }, [atoms, atomPositions, bondingPairs, moleculeName]);

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
        
        // This part is for pre-defined molecules. It will be overridden if a db molecule is loaded
        // because `setBondingPairs` will be called again in `handleLoadMoleculeFromData`.
        const signature = atomSymbols.join('');
        const moleculeData = knownMolecules[signature];
        
        let newBondingPairs: Bond[] = [];
        if (moleculeData) {
            setMoleculeName(moleculeData.name);
            newBondingPairs = moleculeData.pairs;
        } else {
            // Only clear the name if not loading from db.
            // A better check might be needed, but this prevents flickering.
            if(moleculeName === null) setMoleculeName(null);
        }

        // Only set default positions and bonds if they haven't been set by the database loader
        if (bondingPairs.length === 0) {
            setBondingPairs(newBondingPairs);
            setBondingProgress(newBondingPairs.length > 0 ? 1 : 0);
        }

        if (atomPositions.length !== validAtoms.length) {
            const newPositions: THREE.Vector3[] = [];
            if (validAtoms.length > 0) {
                newPositions.push(new THREE.Vector3(0, 0, 0)); // Central atom
                if (validAtoms.length > 1) {
                    const spherePoints = getSpherePoints(validAtoms.length - 1, 15);
                    spherePoints.forEach(point => newPositions.push(point));
                }
            }
            setAtomPositions(newPositions);
        }
        // Loading state is turned off by AtomViewer after rendering is complete
      });
  }, [atomSymbols, elementList, fetchAtomData]);
  
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

  const handleSlowMotionToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setIsSlowMotion(checked);
    if (checked) {
        setPreviousElectronSpeed(electronSpeed);
        setElectronSpeed(electronSpeed / 100);
    } else {
        setElectronSpeed(previousElectronSpeed);
    }
  };

  const handleSpeedInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSpeedInputValue(value);

    if (value === '' || value.endsWith('.')) {
        return;
    }

    const percentage = parseFloat(value);
    if (!isNaN(percentage) && percentage >= 0 && percentage <= 100000) {
        setElectronSpeed(percentage / 100);
    }
  };

  const handleSpeedInputBlur = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    let percentage = parseFloat(value);
    
    if (isNaN(percentage) || percentage < 0) {
        percentage = 0;
    } else if (percentage > 100000) {
        percentage = 100000;
    }

    setElectronSpeed(percentage / 100);
  };


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
                     <div className="flex items-center space-x-2 ml-auto">
                      {moleculeName && (
                          <button 
                              onClick={handleGetInfoClick}
                              className="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-full hover:bg-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 disabled:bg-blue-800/50 disabled:cursor-wait"
                              disabled={isInfoLoading}
                          >
                            {isInfoLoading ? '...' : 'Get Info'}
                          </button>
                      )}
                      <button
                          onClick={handleExportJSON}
                          className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full hover:bg-green-500 transition-colors focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75 disabled:bg-green-800/50 disabled:cursor-not-allowed"
                          disabled={atoms.length === 0}
                          title="Download molecule data as a JSON file"
                      >
                          Download JSON
                      </button>
                       <button
                          onClick={handleExportGLTF}
                          className="px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded-full hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-opacity-75 disabled:bg-indigo-800/50 disabled:cursor-not-allowed"
                          disabled={atoms.length === 0}
                          title="Download molecule as a 3D model (.glb)"
                      >
                          Download GLB
                      </button>
                    </div>
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

            <DatabaseSearch 
              onMoleculeLoad={handleLoadMoleculeFromData}
              setIsSearching={setIsSearching}
            />

            <div className="p-3 bg-gray-800/70 rounded-md border border-gray-600 space-y-3">
                <h2 className="text-lg font-semibold text-teal-300 border-b border-gray-600 pb-2 mb-2">
                    Visualization Controls
                </h2>
                <div>
                  <div className="flex justify-between items-center mb-2">
                      <label className="text-sm font-medium text-gray-300">Display Model</label>
                      <div className="flex items-center justify-center bg-gray-700 rounded-full p-1">
                          <button
                              onClick={() => setVisualizationMode('bohr')}
                              className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${visualizationMode === 'bohr' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-gray-600'}`}
                          >
                              Bohr
                          </button>
                          <button
                              onClick={() => setVisualizationMode('quantum')}
                              className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${visualizationMode === 'quantum' ? 'bg-purple-500 text-white' : 'text-gray-400 hover:bg-gray-600'}`}
                          >
                              Quantum
                          </button>
                      </div>
                  </div>
                </div>
                 <div className="border-t border-gray-700 pt-3 space-y-3">
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
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-1">
                          <label htmlFor="speed-slider" className="text-sm font-medium text-gray-300">Electron Speed</label>
                          <div className="relative flex items-center">
                              <input 
                                  type="text"
                                  value={speedInputValue}
                                  onChange={handleSpeedInputChange}
                                  onBlur={handleSpeedInputBlur}
                                  disabled={visualizationMode === 'quantum' || isSlowMotion}
                                  className="bg-gray-900/50 border border-gray-600 text-purple-400 font-bold text-lg rounded-md w-28 text-right pr-7 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-700/50 disabled:cursor-not-allowed"
                                  aria-label="Electron speed percentage"
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-purple-400 font-bold text-lg pointer-events-none">%</span>
                          </div>
                      </div>
                      <input 
                        type="range" 
                        id="speed-slider" 
                        min="0" max="1" 
                        step="0.01" 
                        value={Math.min(electronSpeed, 1)} 
                        onChange={(e) => setElectronSpeed(parseFloat(e.target.value))} 
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500 disabled:accent-gray-600 disabled:cursor-not-allowed"
                        disabled={visualizationMode === 'quantum' || isSlowMotion}
                      />
                       <div className="flex items-center justify-end space-x-2 pt-1">
                        <label htmlFor="slow-motion-checkbox" className="text-sm font-medium text-gray-400 cursor-pointer select-none">Slow Motion</label>
                        <input
                          type="checkbox"
                          id="slow-motion-checkbox"
                          checked={isSlowMotion}
                          onChange={handleSlowMotionToggle}
                          className="h-5 w-5 bg-gray-700 border-gray-600 rounded cursor-pointer accent-purple-500 focus:ring-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={visualizationMode === 'quantum'}
                        />
                      </div>
                    </div>
                    <div className="space-y-3 border-t border-gray-700 pt-3">
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label htmlFor="trail-length-slider" className="text-sm font-medium text-gray-300">Trail Length</label>
                                <span className="font-bold text-teal-400 text-lg">{trailLength}</span>
                            </div>
                            <input 
                              type="range" 
                              id="trail-length-slider" 
                              min="1" max="50" 
                              step="1" 
                              value={trailLength} 
                              onChange={(e) => setTrailLength(parseInt(e.target.value))} 
                              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-teal-500 disabled:accent-gray-600 disabled:cursor-not-allowed"
                              disabled={visualizationMode === 'quantum'}
                              aria-label="Electron trail length"
                            />
                        </div>
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label htmlFor="trail-opacity-slider" className="text-sm font-medium text-gray-300">Trail Opacity</label>
                                <span className="font-bold text-teal-400 text-lg">{(trailOpacity * 100).toFixed(0)}%</span>
                            </div>
                            <input 
                              type="range" 
                              id="trail-opacity-slider" 
                              min="0" max="1" 
                              step="0.01" 
                              value={trailOpacity} 
                              onChange={(e) => setTrailOpacity(parseFloat(e.target.value))} 
                              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-teal-500 disabled:accent-gray-600 disabled:cursor-not-allowed"
                              disabled={visualizationMode === 'quantum'}
                              aria-label="Electron trail opacity"
                            />
                        </div>
                    </div>
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
          visualizationMode={visualizationMode}
          trailLength={trailLength}
          trailOpacity={trailOpacity}
        />
      </main>

      {showInfoCard && (
          <MoleculeInfoCard
              moleculeName={moleculeName}
              info={moleculeInfo}
              loading={isInfoLoading}
              error={infoError}
              onClose={() => setShowInfoCard(false)}
          />
      )}
      
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

       {(isLoading || isSearching) && (
        <div id="loading-overlay" className="absolute inset-0 bg-gray-900/80 flex items-center justify-center z-50 transition-opacity duration-300">
            <div className="text-center">
                <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                {isSearching && <p className="mt-4 text-white text-lg">Searching databases...</p>}
            </div>
        </div>
      )}

      <footer className="absolute bottom-0 left-0 right-0 p-2 text-center text-xs text-gray-500 z-10 bg-gray-900/50">
        <p>Use your mouse to orbit (left-click & drag), zoom (scroll), and pan (right-click & drag).</p>
        <p className="mt-1">Right-click an atom to manage its bonds. Drag atoms to reposition them.</p>
      </footer>
    </div>
  );
};

export default App;
