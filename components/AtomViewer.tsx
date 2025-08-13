
import React, { useRef, useEffect, memo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DragControls } from 'three/examples/jsm/controls/DragControls.js';
import type { Atom, Bond } from '../types';

interface AtomViewerProps {
  atoms: Atom[];
  atomPositions: THREE.Vector3[];
  onAtomPositionChange: (index: number, position: THREE.Vector3) => void;
  bondingPairs: Bond[];
  bondingProgress: number;
  electronSpeed: number;
  setIsLoading: (isLoading: boolean) => void;
  onAtomRightClick: (atomIndex: number, x: number, y: number) => void;
}

// --- Constants ---
const ELECTRON_SIZE = 0.08;
const NUCLEUS_SCALE_FACTOR = 0.3;
const SHELL_BASE_RADIUS = 2.5;
const SHELL_SPACING = 1.8;
const BOND_RADIUS = 0.15;
const DOUBLE_BOND_SPACING = 0.35;
const TRIPLE_BOND_SPACING = 0.35;


// --- Data Structures for Animation ---
interface AnimatedObject {
    nucleus: THREE.Mesh;
    shellPaths: THREE.Mesh[];
    electronPivots: THREE.Object3D[];
}

// --- Helper Functions ---

/**
 * Creates all the THREE.js objects for a single atom.
 */
function createAtomModel(atom: Atom, position: THREE.Vector3): AnimatedObject {
    const animObject: AnimatedObject = {
        nucleus: new THREE.Mesh(),
        shellPaths: [],
        electronPivots: [],
    };

    const atomScale = Math.max(0.5, Math.cbrt(atom.atomicMass) * NUCLEUS_SCALE_FACTOR);

    // Nucleus
    const nucleusColor = new THREE.Color(`#${atom.cpkHex || 'cccccc'}`);
    animObject.nucleus = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 32),
        new THREE.MeshStandardMaterial({
            color: nucleusColor,
            emissive: nucleusColor,
            emissiveIntensity: 0.2,
            metalness: 0.1,
            roughness: 0.7,
        })
    );
    animObject.nucleus.scale.setScalar(atomScale);
    animObject.nucleus.position.copy(position);

    // Shells and Electrons
    atom.shells.forEach((numElectrons, shellIndex) => {
        const shellRadius = (SHELL_BASE_RADIUS + shellIndex * SHELL_SPACING) * atomScale;

        const shellPath = new THREE.Mesh(
            new THREE.TorusGeometry(shellRadius, 0.02 * atomScale, 16, 100),
            new THREE.MeshBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.3 })
        );
        shellPath.rotation.x = Math.PI / 2;
        animObject.shellPaths.push(shellPath);

        const electronMaterial = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.6 });
        const electronGeometry = new THREE.SphereGeometry(ELECTRON_SIZE, 16, 16);
        const points = getSpherePoints(numElectrons, shellRadius);

        for (let i = 0; i < numElectrons; i++) {
            const pivot = new THREE.Object3D();
            const electron = new THREE.Mesh(electronGeometry.clone(), electronMaterial.clone());
            electron.position.copy(points[i]);
            pivot.add(electron);
            animObject.electronPivots.push(pivot);
        }
    });

    return animObject;
}

/**
 * Generates points on a sphere for distributing objects evenly.
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

/**
 * Completely clears all atoms and bonds from the scene and disposes of their resources.
 * This more robust "full cleanup" approach iterates through all children of the modelGroup,
 * ensuring no orphaned WebGL objects are left behind, which can prevent rendering glitches.
 */
function cleanupScene(
    modelGroup: THREE.Group,
    animatedObjects: React.MutableRefObject<AnimatedObject[]>,
    bonds: React.MutableRefObject<THREE.Group[]>
) {
    while (modelGroup.children.length > 0) {
        const object = modelGroup.children[0];
        
        // Traverse the object and its descendants to dispose of materials and geometries
        object.traverse(child => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    // Material can be an array or a single material
                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => material.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
        
        // Remove the object from the group
        modelGroup.remove(object);
    }
    
    // Also reset the state-tracking refs
    animatedObjects.current = [];
    bonds.current = [];
}


const AtomViewer: React.FC<AtomViewerProps> = ({ atoms, atomPositions, onAtomPositionChange, bondingPairs, bondingProgress, electronSpeed, setIsLoading, onAtomRightClick }) => {
    const mountRef = useRef<HTMLDivElement>(null);

    // Core Three.js refs
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const modelGroupRef = useRef<THREE.Group | null>(null);
    const dragControlsRef = useRef<DragControls | null>(null);
    const raycasterRef = useRef<THREE.Raycaster | null>(null);
    const mouseRef = useRef<THREE.Vector2 | null>(null);
    
    // Refs for animation state
    const animatedObjectsRef = useRef<AnimatedObject[]>([]);
    const bondsRef = useRef<THREE.Group[]>([]);
    const animationStateRef = useRef({ speed: electronSpeed, bondingProgress: bondingProgress });

    // Update animation state when props change
    useEffect(() => {
        animationStateRef.current.speed = electronSpeed;
        animationStateRef.current.bondingProgress = bondingProgress;
    }, [electronSpeed, bondingProgress]);


    // Initialize Three.js scene, camera, renderer, and animation loop
    useEffect(() => {
        if (!mountRef.current) return;
        const currentMount = mountRef.current;

        // --- Scene and Camera ---
        sceneRef.current = new THREE.Scene();
        sceneRef.current.background = new THREE.Color(0x111827);
        cameraRef.current = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 10000);
        cameraRef.current.position.set(0, 15, 50);

        // --- Renderer ---
        rendererRef.current = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        rendererRef.current.setSize(currentMount.clientWidth, currentMount.clientHeight);
        rendererRef.current.setPixelRatio(window.devicePixelRatio);
        currentMount.appendChild(rendererRef.current.domElement);
        
        // --- Model Group ---
        modelGroupRef.current = new THREE.Group();
        sceneRef.current.add(modelGroupRef.current);

        // --- Controls ---
        controlsRef.current = new OrbitControls(cameraRef.current, rendererRef.current.domElement);
        controlsRef.current.enableDamping = true;
        controlsRef.current.minDistance = 5;
        controlsRef.current.maxDistance = 500;

        // --- Lighting ---
        sceneRef.current.add(new THREE.AmbientLight(0xffffff, 0.7));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.8);
        directionalLight.position.set(10, 20, 15);
        sceneRef.current.add(directionalLight);

        // --- Raycaster for Context Menu ---
        raycasterRef.current = new THREE.Raycaster();
        mouseRef.current = new THREE.Vector2();

        const handleContextMenu = (event: MouseEvent) => {
            event.preventDefault();

            if (!mouseRef.current || !cameraRef.current || !raycasterRef.current || !modelGroupRef.current || !mountRef.current) return;
            
            const rect = mountRef.current.getBoundingClientRect();
            mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
            
            const nuclei = animatedObjectsRef.current.map(obj => obj.nucleus);
            const intersects = raycasterRef.current.intersectObjects(nuclei);
            
            if (intersects.length > 0) {
                const intersect = intersects[0];
                const atomIndex = intersect.object.userData.atomIndex;
                if (atomIndex !== undefined) {
                    onAtomRightClick(atomIndex, event.clientX, event.clientY);
                }
            }
        };
        currentMount.addEventListener('contextmenu', handleContextMenu);


        // --- Animation Loop ---
        const clock = new THREE.Clock();
        const moleculeCenter = new THREE.Vector3();
        const orbitalCenter = new THREE.Vector3();
        const bondUpVector = new THREE.Vector3(0, 1, 0);
        const bondDirection = new THREE.Vector3();

        const animate = () => {
            requestAnimationFrame(animate);
            if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) return;
            
            const delta = clock.getDelta();
            const { speed, bondingProgress } = animationStateRef.current;
            const animatedObjects = animatedObjectsRef.current;
            const bonds = bondsRef.current;
            
            if (animatedObjects.length === 0) {
                controlsRef.current.update();
                rendererRef.current.render(sceneRef.current, cameraRef.current);
                return;
            };

            moleculeCenter.set(0, 0, 0);
            if (animatedObjects.length > 0) {
              for (const obj of animatedObjects) {
                  moleculeCenter.add(obj.nucleus.position);
              }
              moleculeCenter.divideScalar(animatedObjects.length);
            }
            
            animatedObjects.forEach((obj, index) => {
                obj.shellPaths.forEach(shell => {
                    shell.position.copy(obj.nucleus.position);
                    (shell.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - bondingProgress);
                });
                
                obj.electronPivots.forEach((pivot, i) => {
                    orbitalCenter.lerpVectors(obj.nucleus.position, moleculeCenter, bondingProgress);
                    pivot.position.copy(orbitalCenter);
                    
                    const speedFactor = speed * 1.5;
                    const rotationX = delta * speedFactor * (0.5 + (i % 5) * 0.1);
                    const rotationY = delta * speedFactor * (0.5 + (i % 7) * 0.1);
                    pivot.rotation.x += rotationX;
                    pivot.rotation.y += rotationY;
                });
            });

            if (bonds.length > 0 && animatedObjects.length > 1) {
                bonds.forEach((bondGroup) => {
                     bondGroup.children.forEach(mesh => {
                        if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
                            mesh.material.opacity = bondingProgress;
                        }
                    });

                    const { pair } = bondGroup.userData;
                    if (!pair || animatedObjects[pair[0]] === undefined || animatedObjects[pair[1]] === undefined) return;
                    const posA = animatedObjects[pair[0]].nucleus.position;
                    const posB = animatedObjects[pair[1]].nucleus.position;
                    const distance = posA.distanceTo(posB);

                    bondGroup.position.copy(posA).lerp(posB, 0.5);
                    bondDirection.subVectors(posB, posA).normalize();
                    bondGroup.quaternion.setFromUnitVectors(bondUpVector, bondDirection);
                    bondGroup.scale.set(1, distance, 1);
                    bondGroup.visible = true;
                });
            }

            controlsRef.current.update();
            rendererRef.current.render(sceneRef.current, cameraRef.current);
        };
        animate();

        const handleResize = () => {
            if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
            const width = mountRef.current.clientWidth;
            const height = mountRef.current.clientHeight;
            cameraRef.current.aspect = width / height;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(width, height);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            currentMount.removeEventListener('contextmenu', handleContextMenu);
            if (currentMount && rendererRef.current) {
                currentMount.removeChild(rendererRef.current.domElement);
            }
            if (modelGroupRef.current) {
                cleanupScene(modelGroupRef.current, animatedObjectsRef, bondsRef);
            }
            rendererRef.current?.dispose();
        };
    }, [onAtomRightClick]);

    // Rebuild the scene whenever atoms or bonds change using a robust "cleanup and rebuild" strategy.
    useEffect(() => {
        if (!sceneRef.current || !modelGroupRef.current || !cameraRef.current || !rendererRef.current) {
            if (atoms.length === 0) setIsLoading(false);
            return;
        }
        
        setIsLoading(true);

        // Using a short timeout to ensure the loading spinner is visible and to prevent blocking the main thread during setup.
        setTimeout(() => {
            const modelGroup = modelGroupRef.current!;
            
            // --- 1. FULL CLEANUP of previous state ---
            cleanupScene(modelGroup, animatedObjectsRef, bondsRef);

            const nucleiForDrag: THREE.Mesh[] = [];

            // --- 2. Rebuild Atoms from props ---
            atoms.forEach((atom, index) => {
                const position = atomPositions[index] || new THREE.Vector3(); // Safety check for position
                const newObject = createAtomModel(atom, position);
                newObject.nucleus.userData = { symbol: atom.symbol, atomIndex: index };
                
                // Add all parts of the atom to the main model group
                modelGroup.add(newObject.nucleus);
                newObject.shellPaths.forEach(p => modelGroup.add(p));
                newObject.electronPivots.forEach(p => modelGroup.add(p));

                animatedObjectsRef.current.push(newObject);
                nucleiForDrag.push(newObject.nucleus);
            });
            
            // --- 3. Rebuild Bonds from props ---
            if (bondingPairs.length > 0 && atoms.length > 1) {
                const bondMaterial = new THREE.MeshStandardMaterial({
                    color: 0xaaaaaa, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0
                });
                const bondGeometry = new THREE.CylinderGeometry(BOND_RADIUS, BOND_RADIUS, 1, 12);
    
                bondingPairs.forEach(bondInfo => {
                    const { pair, type } = bondInfo;
                    if (pair[0] < atoms.length && pair[1] < atoms.length) {
                         const bondGroup = new THREE.Group();
                         bondGroup.userData.pair = pair;
                         bondGroup.visible = false;
                        
                        if (type === 3) { // Triple bond
                            const bond1 = new THREE.Mesh(bondGeometry.clone(), bondMaterial.clone());
                            bond1.position.x = -TRIPLE_BOND_SPACING;
                            const bond2 = new THREE.Mesh(bondGeometry.clone(), bondMaterial.clone());
                            const bond3 = new THREE.Mesh(bondGeometry.clone(), bondMaterial.clone());
                            bond3.position.x = TRIPLE_BOND_SPACING;
                            bondGroup.add(bond1, bond2, bond3);
                        } else if (type === 2) { // Double bond
                            const bond1 = new THREE.Mesh(bondGeometry.clone(), bondMaterial.clone());
                            bond1.position.x = -DOUBLE_BOND_SPACING / 2;
                            const bond2 = new THREE.Mesh(bondGeometry.clone(), bondMaterial.clone());
                            bond2.position.x = DOUBLE_BOND_SPACING / 2;
                            bondGroup.add(bond1, bond2);
                        } else { // Single bond
                            const bond = new THREE.Mesh(bondGeometry.clone(), bondMaterial.clone());
                            bondGroup.add(bond);
                        }
                        
                        modelGroup.add(bondGroup);
                        bondsRef.current.push(bondGroup);
                    }
                });
                bondGeometry.dispose(); // Dispose the template geometry
            }

            // --- 4. Re-setup Drag Controls ---
            if (dragControlsRef.current) {
                dragControlsRef.current.dispose();
            }
            if(nucleiForDrag.length > 0 && cameraRef.current && rendererRef.current) {
                const dragControls = new DragControls(nucleiForDrag, cameraRef.current, rendererRef.current.domElement);
                dragControls.addEventListener('dragstart', () => {
                    if (controlsRef.current) controlsRef.current.enabled = false;
                });
                dragControls.addEventListener('drag', (event) => {
                    const animatedObject = animatedObjectsRef.current[event.object.userData.atomIndex];
                    if (animatedObject) {
                        animatedObject.nucleus.position.copy(event.object.position);
                    }
                });
                dragControls.addEventListener('dragend', (event) => {
                    if (controlsRef.current) controlsRef.current.enabled = true;
                    if (event.object.userData.atomIndex !== undefined) {
                        onAtomPositionChange(event.object.userData.atomIndex, event.object.position);
                    }
                });
                dragControlsRef.current = dragControls;
            } else {
                dragControlsRef.current = null;
            }

            setIsLoading(false);
        }, 50);

    }, [atoms, atomPositions, bondingPairs, setIsLoading, onAtomPositionChange]);

    return <div ref={mountRef} className="w-full h-full" />;
};

export default memo(AtomViewer);
