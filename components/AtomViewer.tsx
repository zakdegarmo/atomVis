
import React, { useRef, useEffect, memo } from 'react';
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
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
  visualizationMode: 'bohr' | 'quantum';
  trailLength: number;
  trailOpacity: number;
}

// --- Constants ---
const ELECTRON_SIZE = 0.08;
const NUCLEUS_SCALE_FACTOR = 0.3;
const SHELL_BASE_RADIUS = 2.5;
const SHELL_SPACING = 1.8;
const BOND_RADIUS = 0.15;
const DOUBLE_BOND_SPACING = 0.35;
const TRIPLE_BOND_SPACING = 0.35;
const ORBITAL_OPACITY = 0.35;
const ORBITAL_COLORS = {
    s: 0x6495ED, // CornflowerBlue
    p: 0xFFD700, // Gold
    d: 0xBA55D3, // MediumOrchid
    f: 0x3CB371, // MediumSeaGreen
};

// --- Constants for Quantum Trail Effect ---
const QUANTUM_TRAIL_LENGTH = 15;
const ELECTRON_TARGET_THRESHOLD = 0.5;
const ELECTRON_MOVE_SPEED = 0.08;


// --- Data Structures for Animation ---
interface AnimatedObject {
    nucleus: THREE.Mesh;
    shellPaths: THREE.Mesh[];
    electronPivots: THREE.Object3D[];
    electrons: THREE.Mesh[];
    electronTrails: THREE.Points | null;
}

interface QuantumAnimatedObject {
    nucleus: THREE.Mesh;
    orbitals: THREE.Group;
    electronCloud: THREE.Points | null;
}

interface ElectronAnimationState {
    orbitalKey: string;
    currentPosition: THREE.Vector3;
    targetPosition: THREE.Vector3;
}


// --- Helper Functions ---

/**
 * Gets a random point within a sphere, distributed evenly by volume.
 */
function getRandomPointInSphere(radius: number): THREE.Vector3 {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * Math.cbrt(Math.random());
    return new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
    );
}


/**
 * Gets a random point within a specified orbital type.
 * Uses simplified shapes for performance and clarity.
 */
function getRandomPointInOrbital(orbitalKey: string, scale: number): THREE.Vector3 {
    const principal = parseInt(orbitalKey.charAt(0), 10);
    const type = orbitalKey.charAt(1) as 's' | 'p' | 'd' | 'f';
    const baseRadius = 0.9 * principal * scale;

    if (type === 's') {
        return getRandomPointInSphere(baseRadius);
    }
    if (type === 'p') {
        const lobeSize = baseRadius * 0.7;
        const axisIndex = Math.floor(Math.random() * 3); // 0 for x, 1 for y, 2 for z
        const direction = Math.random() < 0.5 ? 1 : -1;
        
        const pointInLobe = getRandomPointInSphere(lobeSize);
        if (axisIndex === 0) pointInLobe.x += direction * baseRadius;
        else if (axisIndex === 1) pointInLobe.y += direction * baseRadius;
        else pointInLobe.z += direction * baseRadius;
        return pointInLobe;
    }
    // For d and f, a simple spherical distribution is a good, performant approximation
    if (type === 'd') {
        return getRandomPointInSphere(baseRadius * 1.5);
    }
    if (type === 'f') {
        return getRandomPointInSphere(baseRadius * 1.8);
    }
    return new THREE.Vector3(); // Fallback
}


/**
 * Parses the semantic electron configuration string (e.g., "[Ar] 3d6 4s2")
 * to get the valence orbitals and their electron counts.
 */
function parseElectronConfiguration(semanticConfig: string): Record<string, number> {
    const config: Record<string, number> = {};
    const justOrbitals = semanticConfig.replace(/\[[A-Za-z]+\]\s*/, '');
    const orbitalRegex = /(\d+[spdf])(\d+)/g;
    let match;
    while ((match = orbitalRegex.exec(justOrbitals)) !== null) {
        config[match[1]] = parseInt(match[2], 10);
    }
    return config;
}

/**
 * Creates representative 3D shapes for atomic orbitals based on valence electron configuration.
 */
function createOrbitalShapes(config: Record<string, number>, scale: number): THREE.Group {
    const orbitalGroup = new THREE.Group();
    const orbitalMaterial = (color: number) => new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: ORBITAL_OPACITY,
        emissive: color,
        emissiveIntensity: 0.1,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.1,
    });

    for (const orbitalKey in config) {
        if (!config[orbitalKey]) continue; // Skip if no electrons in this orbital

        const principal = parseInt(orbitalKey.charAt(0), 10);
        const type = orbitalKey.charAt(1) as 's' | 'p' | 'd' | 'f';
        const baseRadius = 0.9 * principal * scale;

        if (type === 's') {
            const geometry = new THREE.SphereGeometry(baseRadius, 32, 32);
            const mesh = new THREE.Mesh(geometry, orbitalMaterial(ORBITAL_COLORS.s));
            orbitalGroup.add(mesh);
        } else if (type === 'p') {
            const lobeSize = baseRadius * 0.7;
            const lobeGeometry = new THREE.SphereGeometry(lobeSize, 16, 16);
            const material = orbitalMaterial(ORBITAL_COLORS.p);
            
            const createDumbbell = (axis: 'x' | 'y' | 'z') => {
                const dumbbell = new THREE.Group();
                const lobe1 = new THREE.Mesh(lobeGeometry, material.clone());
                const lobe2 = lobe1.clone();
                lobe1.position[axis] = baseRadius;
                lobe2.position[axis] = -baseRadius;
                dumbbell.add(lobe1, lobe2);
                return dumbbell;
            };

            orbitalGroup.add(createDumbbell('x'), createDumbbell('y'), createDumbbell('z'));
        } else if (type === 'd') {
            const lobeSize = baseRadius * 0.5;
            const lobeGeometry = new THREE.SphereGeometry(lobeSize, 16, 16);
            const material = orbitalMaterial(ORBITAL_COLORS.d);

            // d_z^2 shape
            const dz2 = new THREE.Group();
            const lobe1 = new THREE.Mesh(lobeGeometry, material.clone());
            lobe1.position.z = baseRadius;
            const lobe2 = lobe1.clone();
            lobe2.position.z = -baseRadius;
            const torus = new THREE.Mesh(
                new THREE.TorusGeometry(baseRadius * 0.9, lobeSize * 0.4, 8, 50),
                material.clone()
            );
            torus.rotation.x = Math.PI / 2;
            dz2.add(lobe1, lobe2, torus);
            dz2.rotation.y = 0.5; // Tilt slightly

            // Representative clover shape for other d-orbitals
            const clover = new THREE.Group();
            const c_lobe1 = new THREE.Mesh(lobeGeometry, material.clone());
            c_lobe1.position.set(baseRadius, baseRadius, 0);
            const c_lobe2 = c_lobe1.clone();
            c_lobe2.position.set(-baseRadius, -baseRadius, 0);
            const c_lobe3 = c_lobe1.clone();
            c_lobe3.position.set(-baseRadius, baseRadius, 0);
            const c_lobe4 = c_lobe1.clone();
            c_lobe4.position.set(baseRadius, -baseRadius, 0);
            clover.add(c_lobe1, c_lobe2, c_lobe3, c_lobe4);
            clover.rotation.z = 0.7; // Tilt slightly

            orbitalGroup.add(dz2, clover);
        } else if (type === 'f') {
            // Simplified representation: a large sphere for the f-shell cloud
            const geometry = new THREE.SphereGeometry(baseRadius * 1.8, 32, 32);
            const fCloud = new THREE.Mesh(geometry, orbitalMaterial(ORBITAL_COLORS.f));
            orbitalGroup.add(fCloud);
        }
    }
    return orbitalGroup;
}

/**
 * Creates the THREE.js objects for a single atom using the Quantum model (orbitals).
 */
function createQuantumAtomModel(atom: Atom, position: THREE.Vector3): QuantumAnimatedObject {
    const atomScale = Math.max(0.5, Math.cbrt(atom.atomicMass) * NUCLEUS_SCALE_FACTOR);
    const electronColor = new THREE.Color(`#${atom.cpkHex || '00ffff'}`);

    // Nucleus
    const nucleusColor = new THREE.Color(`#${atom.cpkHex || 'cccccc'}`);
    const nucleus = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 32),
        new THREE.MeshStandardMaterial({
            color: nucleusColor,
            emissive: nucleusColor,
            emissiveIntensity: 0.2,
            metalness: 0.1,
            roughness: 0.7,
        })
    );
    nucleus.scale.setScalar(atomScale);
    nucleus.position.copy(position);

    // Orbitals
    const valenceConfig = parseElectronConfiguration(atom.electronConfigurationSemantic);
    const orbitals = createOrbitalShapes(valenceConfig, atomScale);

    // Electron Cloud with Trails
    let electronCloud: THREE.Points | null = null;
    const valenceElectronsList: { orbitalKey: string }[] = [];
    for (const orbitalKey in valenceConfig) {
        for(let i=0; i < valenceConfig[orbitalKey]; i++) {
            valenceElectronsList.push({ orbitalKey });
        }
    }

    if (valenceElectronsList.length > 0) {
        const totalPoints = valenceElectronsList.length * QUANTUM_TRAIL_LENGTH;
        const pointsGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(totalPoints * 3);
        const colors = new Float32Array(totalPoints * 3);
        const electronAnimations: ElectronAnimationState[] = [];

        valenceElectronsList.forEach(({ orbitalKey }) => {
            const startPos = getRandomPointInOrbital(orbitalKey, atomScale);
            electronAnimations.push({
                orbitalKey,
                currentPosition: startPos.clone(),
                targetPosition: getRandomPointInOrbital(orbitalKey, atomScale),
            });
        });

        electronAnimations.forEach((anim, electronIndex) => {
            for (let i = 0; i < QUANTUM_TRAIL_LENGTH; i++) {
                const index = (electronIndex * QUANTUM_TRAIL_LENGTH + i) * 3;
                positions[index] = anim.currentPosition.x;
                positions[index + 1] = anim.currentPosition.y;
                positions[index + 2] = anim.currentPosition.z;

                const brightness = 1.0 - (i / QUANTUM_TRAIL_LENGTH);
                colors[index] = electronColor.r * brightness;
                colors[index + 1] = electronColor.g * brightness;
                colors[index + 2] = electronColor.b * brightness;
            }
        });

        pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        pointsGeometry.userData.electronAnimations = electronAnimations;
        
        const pointsMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: ELECTRON_SIZE * 2.0,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });
        electronCloud = new THREE.Points(pointsGeometry, pointsMaterial);
    }

    return { nucleus, orbitals, electronCloud };
}


/**
 * Creates all the THREE.js objects for a single atom using the Bohr model.
 */
function createAtomModel(atom: Atom, position: THREE.Vector3, trailLength: number, trailOpacity: number): AnimatedObject {
    const animObject: Omit<AnimatedObject, 'electrons' | 'electronTrails'> = {
        nucleus: new THREE.Mesh(),
        shellPaths: [],
        electronPivots: [],
    };
    const electrons: THREE.Mesh[] = [];
    let electronTrails: THREE.Points | null = null;

    const atomScale = Math.max(0.5, Math.cbrt(atom.atomicMass) * NUCLEUS_SCALE_FACTOR);
    const electronColor = new THREE.Color(`#${atom.cpkHex || '00ffff'}`);

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

    // Shared electron resources
    const electronMaterial = new THREE.MeshStandardMaterial({ color: electronColor, emissive: electronColor, emissiveIntensity: 0.6 });
    const electronGeometry = new THREE.SphereGeometry(ELECTRON_SIZE, 16, 16);

    // Shells and Electrons
    atom.shells.forEach((numElectrons, shellIndex) => {
        const shellRadius = (SHELL_BASE_RADIUS + shellIndex * SHELL_SPACING) * atomScale;

        const shellPath = new THREE.Mesh(
            new THREE.TorusGeometry(shellRadius, 0.02 * atomScale, 16, 100),
            new THREE.MeshBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.3 })
        );
        shellPath.rotation.x = Math.PI / 2;
        animObject.shellPaths.push(shellPath);

        const points = getSpherePoints(numElectrons, shellRadius);

        for (let i = 0; i < numElectrons; i++) {
            const pivot = new THREE.Object3D();
            const electron = new THREE.Mesh(electronGeometry.clone(), electronMaterial.clone());
            electron.position.copy(points[i]);
            pivot.add(electron);
            animObject.electronPivots.push(pivot);
            electrons.push(electron);
        }
    });

    // Electron Trails
    if (electrons.length > 0 && trailLength > 0) {
        const totalPoints = electrons.length * trailLength;
        const trailGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(totalPoints * 3);
        const colors = new Float32Array(totalPoints * 3);

        const initialPos = new THREE.Vector3();

        electrons.forEach((electron, electronIndex) => {
            // Need to get initial world position.
            // Temporarily add pivot to nucleus to calculate it.
            animObject.nucleus.add(animObject.electronPivots[electronIndex]);
            electron.getWorldPosition(initialPos);
            animObject.nucleus.remove(animObject.electronPivots[electronIndex]);
            
            for (let i = 0; i < trailLength; i++) {
                const index = (electronIndex * trailLength + i) * 3;
                positions[index] = initialPos.x;
                positions[index + 1] = initialPos.y;
                positions[index + 2] = initialPos.z;

                const brightness = 1.0 - (i / trailLength);
                colors[index] = electronColor.r * brightness;
                colors[index + 1] = electronColor.g * brightness;
                colors[index + 2] = electronColor.b * brightness;
            }
        });

        trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        trailGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const trailMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: ELECTRON_SIZE * 2.5,
            transparent: true,
            opacity: trailOpacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });
        electronTrails = new THREE.Points(trailGeometry, trailMaterial);
    }
    
    // Dispose shared geometries after use
    electronGeometry.dispose();

    return { ...animObject, electrons, electronTrails };
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
 */
function cleanupScene(modelGroup: THREE.Group) {
    while (modelGroup.children.length > 0) {
        const object = modelGroup.children[0];
        object.traverse(child => {
            if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(material => material.dispose());
                } else {
                    child.material?.dispose();
                }
            }
        });
        modelGroup.remove(object);
    }
}


const AtomViewer: React.FC<AtomViewerProps> = ({ atoms, atomPositions, onAtomPositionChange, bondingPairs, bondingProgress, electronSpeed, setIsLoading, onAtomRightClick, visualizationMode, trailLength, trailOpacity }) => {
    const mountRef = useRef<HTMLDivElement>(null);

    // Core Three.js refs
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<TrackballControls | null>(null);
    const modelGroupRef = useRef<THREE.Group | null>(null);
    const dragControlsRef = useRef<DragControls | null>(null);
    const raycasterRef = useRef<THREE.Raycaster | null>(null);
    const mouseRef = useRef<THREE.Vector2 | null>(null);
    
    // Refs for animation state
    const animatedObjectsRef = useRef<AnimatedObject[]>([]);
    const quantumObjectsRef = useRef<QuantumAnimatedObject[]>([]);
    const bondsRef = useRef<THREE.Group[]>([]);
    const animationStateRef = useRef({ speed: electronSpeed, bondingProgress: bondingProgress });

    // Update animation state when props change
    useEffect(() => {
        animationStateRef.current.speed = visualizationMode === 'bohr' ? electronSpeed : 0;
        animationStateRef.current.bondingProgress = bondingProgress;
    }, [electronSpeed, bondingProgress, visualizationMode]);


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
        controlsRef.current = new TrackballControls(cameraRef.current, rendererRef.current.domElement);
        controlsRef.current.rotateSpeed = 3.0;
        controlsRef.current.zoomSpeed = 1.2;
        controlsRef.current.panSpeed = 0.8;
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
            
            const nuclei = animatedObjectsRef.current.map(obj => obj.nucleus)
              .concat(quantumObjectsRef.current.map(obj => obj.nucleus));
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
        const bondUpVector = new THREE.Vector3(0, 1, 0);
        const bondDirection = new THREE.Vector3();
        const tempWorldPos = new THREE.Vector3();


        const animate = () => {
            requestAnimationFrame(animate);
            if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) return;
            
            const delta = clock.getDelta();
            const { speed, bondingProgress } = animationStateRef.current;
            const bonds = bondsRef.current;
            const animatedObjects = animatedObjectsRef.current;
            const quantumObjects = quantumObjectsRef.current;

            const nuclei = visualizationMode === 'bohr' 
                ? animatedObjects.map(o => o.nucleus)
                : quantumObjects.map(o => o.nucleus);

            if (nuclei.length === 0) {
                controlsRef.current.update();
                rendererRef.current.render(sceneRef.current, cameraRef.current);
                return;
            };

            if(visualizationMode === 'bohr') {
                 animatedObjects.forEach((obj, atomIndex) => {
                    obj.shellPaths.forEach(shell => {
                        shell.position.copy(obj.nucleus.position);
                        (shell.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - bondingProgress);
                    });
                    
                    let targetPosition = obj.nucleus.position.clone();
                    if (bondingProgress > 0) {
                        const bondPartnersPositions: THREE.Vector3[] = [];
                        bondingPairs.forEach(bond => {
                            let partnerIndex = -1;
                            if (bond.pair[0] === atomIndex) partnerIndex = bond.pair[1];
                            else if (bond.pair[1] === atomIndex) partnerIndex = bond.pair[0];

                            if (partnerIndex !== -1 && animatedObjects[partnerIndex]) {
                                bondPartnersPositions.push(animatedObjects[partnerIndex].nucleus.position);
                            }
                        });

                        if (bondPartnersPositions.length > 0) {
                            const bondCentroid = new THREE.Vector3();
                            bondPartnersPositions.forEach(pos => bondCentroid.add(pos));
                            bondCentroid.divideScalar(bondPartnersPositions.length);
                            targetPosition = bondCentroid;
                        }
                    }
                    
                    obj.electronPivots.forEach((pivot, i) => {
                        const orbitalCenter = new THREE.Vector3();
                        orbitalCenter.lerpVectors(obj.nucleus.position, targetPosition, bondingProgress);
                        pivot.position.copy(orbitalCenter);
        
                        const speedFactor = speed * 21.85/2.5;
                        const rotationX = delta * speedFactor * (0.5 + (i % 5) * 0.1);
                        const rotationY = delta * speedFactor * (0.5 + (i % 7) * 0.1);
                        
                        pivot.rotateY(rotationY);
                        pivot.rotateX(rotationX);
                    });
                });
                // Update electron trails after pivots have been rotated
                animatedObjects.forEach(obj => {
                    if (!obj.electronTrails || obj.electrons.length === 0) return;
                    const positions = obj.electronTrails.geometry.attributes.position as THREE.BufferAttribute;
                    const trailLen = positions.count / obj.electrons.length;
                    
                    obj.electrons.forEach((electron, electronIndex) => {
                        electron.getWorldPosition(tempWorldPos);
                        const trailStartIndex = electronIndex * trailLen;
                        
                        // Shift tail points
                        for (let i = trailLen - 1; i > 0; i--) {
                            const currentPointIndex = trailStartIndex + i;
                            const prevPointIndex = trailStartIndex + i - 1;
                             positions.setXYZ(
                                currentPointIndex, 
                                positions.getX(prevPointIndex), 
                                positions.getY(prevPointIndex), 
                                positions.getZ(prevPointIndex)
                            );
                        }
                        // Update head of the trail
                        positions.setXYZ(trailStartIndex, tempWorldPos.x, tempWorldPos.y, tempWorldPos.z);
                    });
                    positions.needsUpdate = true;
                });

            } else { // Quantum mode
                quantumObjects.forEach(obj => {
                    obj.orbitals.position.copy(obj.nucleus.position);
                    if (obj.electronCloud) {
                        obj.electronCloud.position.copy(obj.nucleus.position);
                        
                        const geometry = obj.electronCloud.geometry;
                        const positions = geometry.attributes.position as THREE.BufferAttribute;
                        const animations = geometry.userData.electronAnimations as ElectronAnimationState[];
                        const atomScale = obj.nucleus.scale.x;

                        animations.forEach((anim, electronIndex) => {
                             if (anim.currentPosition.distanceTo(anim.targetPosition) < ELECTRON_TARGET_THRESHOLD) {
                                anim.targetPosition.copy(getRandomPointInOrbital(anim.orbitalKey, atomScale));
                            }
                            anim.currentPosition.lerp(anim.targetPosition, ELECTRON_MOVE_SPEED);

                            const trailStartIndex = electronIndex * QUANTUM_TRAIL_LENGTH;
                            // Shift trail positions
                            for (let i = QUANTUM_TRAIL_LENGTH - 1; i > 0; i--) {
                                const oldIndex = trailStartIndex + i - 1;
                                const newIndex = trailStartIndex + i;
                                positions.setXYZ(newIndex, positions.getX(oldIndex), positions.getY(oldIndex), positions.getZ(oldIndex));
                            }
                            // Update head of the trail
                            positions.setXYZ(trailStartIndex, anim.currentPosition.x, anim.currentPosition.y, anim.currentPosition.z);
                        });
                        
                        positions.needsUpdate = true;
                    }
                });
            }

            if (bonds.length > 0 && nuclei.length > 1) {
                bonds.forEach((bondGroup) => {
                     bondGroup.children.forEach(mesh => {
                        if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshStandardMaterial) {
                            mesh.material.opacity = bondingProgress;
                        }
                    });

                    const { pair } = bondGroup.userData;
                    if (!pair || nuclei[pair[0]] === undefined || nuclei[pair[1]] === undefined) return;
                    const posA = nuclei[pair[0]].position;
                    const posB = nuclei[pair[1]].position;
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
            if (!mountRef.current || !rendererRef.current || !cameraRef.current || !controlsRef.current) return;
            const width = mountRef.current.clientWidth;
            const height = mountRef.current.clientHeight;
            cameraRef.current.aspect = width / height;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(width, height);
            controlsRef.current.handleResize();
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            currentMount.removeEventListener('contextmenu', handleContextMenu);
            if (currentMount && rendererRef.current) {
                currentMount.removeChild(rendererRef.current.domElement);
            }
            if (modelGroupRef.current) {
                cleanupScene(modelGroupRef.current);
            }
            controlsRef.current?.dispose();
            rendererRef.current?.dispose();
        };
    }, [onAtomRightClick, bondingPairs]);

    // Rebuild the scene whenever atoms, bonds, trail length, or the visualization mode change.
    useEffect(() => {
        if (!sceneRef.current || !modelGroupRef.current || !cameraRef.current || !rendererRef.current) {
            if (atoms.length === 0) setIsLoading(false);
            return;
        }
        
        setIsLoading(true);

        setTimeout(() => {
            const modelGroup = modelGroupRef.current!;
            
            cleanupScene(modelGroup);
            animatedObjectsRef.current = [];
            quantumObjectsRef.current = [];
            bondsRef.current = [];

            const nucleiForDrag: THREE.Mesh[] = [];

            if(visualizationMode === 'bohr') {
                atoms.forEach((atom, index) => {
                    const position = atomPositions[index] || new THREE.Vector3();
                    const newObject = createAtomModel(atom, position, trailLength, trailOpacity);
                    newObject.nucleus.userData = { symbol: atom.symbol, atomIndex: index };
                    
                    modelGroup.add(newObject.nucleus);
                    newObject.shellPaths.forEach(p => modelGroup.add(p));
                    newObject.electronPivots.forEach(p => modelGroup.add(p));
                    if (newObject.electronTrails) {
                        modelGroup.add(newObject.electronTrails);
                    }

                    animatedObjectsRef.current.push(newObject);
                    nucleiForDrag.push(newObject.nucleus);
                });
            } else { // 'quantum'
                 atoms.forEach((atom, index) => {
                    const position = atomPositions[index] || new THREE.Vector3();
                    const newObject = createQuantumAtomModel(atom, position);
                    newObject.nucleus.userData = { symbol: atom.symbol, atomIndex: index };
                    
                    modelGroup.add(newObject.nucleus);
                    modelGroup.add(newObject.orbitals);
                    if (newObject.electronCloud) {
                        modelGroup.add(newObject.electronCloud);
                    }

                    quantumObjectsRef.current.push(newObject);
                    nucleiForDrag.push(newObject.nucleus);
                });
            }
            
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
                bondGeometry.dispose();
            }

            if (dragControlsRef.current) {
                dragControlsRef.current.dispose();
            }
            if(nucleiForDrag.length > 0 && cameraRef.current && rendererRef.current) {
                const dragControls = new DragControls(nucleiForDrag, cameraRef.current, rendererRef.current.domElement);
                dragControls.addEventListener('dragstart', () => {
                    if (controlsRef.current) controlsRef.current.enabled = false;
                });
                dragControls.addEventListener('drag', (event) => {
                    const nucleus = event.object;
                    const index = nucleus.userData.atomIndex;
                     if(visualizationMode === 'bohr') {
                        const bohrObject = animatedObjectsRef.current[index];
                        if(bohrObject) bohrObject.nucleus.position.copy(nucleus.position);
                    } else {
                        const quantumObject = quantumObjectsRef.current[index];
                        if(quantumObject) quantumObject.nucleus.position.copy(nucleus.position);
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

    }, [atoms, atomPositions, bondingPairs, setIsLoading, onAtomPositionChange, visualizationMode, trailLength, trailOpacity]);

     // Effect to efficiently update trail opacity without a full scene rebuild
    useEffect(() => {
        if (visualizationMode === 'bohr') {
            animatedObjectsRef.current.forEach(obj => {
                if (obj.electronTrails) {
                    const material = obj.electronTrails.material as THREE.PointsMaterial;
                    material.opacity = trailOpacity;
                }
            });
        }
    }, [trailOpacity, visualizationMode]);

    return <div ref={mountRef} className="w-full h-full" />;
};

export default memo(AtomViewer);