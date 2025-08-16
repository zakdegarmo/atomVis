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
  quantumMode?: boolean;
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
function createAtomModel(atom: Atom, position: THREE.Vector3, showQuantumCloud = false): AnimatedObject {
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
        // Q: shell capacity (2n^2 for nth shell, or max electrons in any shell for fallback)
        const n = shellIndex + 1;
        const shellCapacity = 2 * n * n;
        const shellRadius = (SHELL_BASE_RADIUS + shellIndex * SHELL_SPACING) * atomScale;

        // --- Cloud or shell path ---
        if (showQuantumCloud) {
            const cloud = createQuantumCloudMesh(atom, shellIndex, atomScale, numElectrons, shellCapacity);
            cloud.position.copy(position);
            animObject.shellPaths.push(cloud);
        } else {
            const shellPath = new THREE.Mesh(
                new THREE.TorusGeometry(shellRadius, 0.02 * atomScale, 16, 100),
                new THREE.MeshBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.3 })
            );
            shellPath.rotation.x = Math.PI / 2;
            animObject.shellPaths.push(shellPath);
        }

        // --- Electron placement using n-gon/torus knot logic ---
        const electronMaterial = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.6 });
        const electronGeometry = new THREE.SphereGeometry(ELECTRON_SIZE, 16, 16);
        // Torus knot parametric placement: P = numElectrons, Q = shellCapacity
        const P = numElectrons;
        const Q = shellCapacity > 0 ? shellCapacity : 1;
        const torusRadius = shellRadius;
        const tubeRadius = 0.5 * atomScale;
        for (let i = 0; i < numElectrons; i++) {
            const t = (i / numElectrons) * Math.PI * 2;
            // Torus knot parametric equations
            const x = (torusRadius + tubeRadius * Math.cos(Q * t)) * Math.cos(P * t);
            const y = (torusRadius + tubeRadius * Math.cos(Q * t)) * Math.sin(P * t);
            const z = tubeRadius * Math.sin(Q * t);
            const pivot = new THREE.Object3D();
            const electron = new THREE.Mesh(electronGeometry.clone(), electronMaterial.clone());
            electron.position.set(x, y, z);
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


// --- Quantum Cloud Helper ---
function createQuantumCloudMesh(atom: Atom, shellIndex: number, atomScale: number, numElectrons?: number, shellCapacity?: number) {
    // Use n-gon/torus knot logic for cloud: P = numElectrons, Q = shellCapacity
    const P = numElectrons || 3;
    const Q = shellCapacity || 4;
    const radius = (3.5 + shellIndex * 2.2) * atomScale;
    const tube = 0.35 * atomScale;
    const color = new THREE.Color(0xff9900); // neon orange
    const geometry = new THREE.TorusKnotGeometry(radius, tube, 128, 16, P, Q);
    const material = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.13, // more transparent
        emissive: color,
        emissiveIntensity: 0.7,
        metalness: 0.1,
        roughness: 0.2,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 100;
    // Animate rotation along n-gon axis (P)
    mesh.userData.animateQuantumCloud = (delta: number) => {
        mesh.rotation.y += delta * 0.25 * P;
        mesh.rotation.x += delta * 0.12 * Q;
    };
    return mesh;
}

const AtomViewer: React.FC<AtomViewerProps> = ({ atoms, atomPositions, onAtomPositionChange, bondingPairs, bondingProgress, electronSpeed, setIsLoading, onAtomRightClick, quantumMode = false }) => {
    console.log('QuantumMode prop in AtomViewer:', quantumMode);
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
    // Store current atom positions for tweening
    const currentAtomPositionsRef = useRef<THREE.Vector3[]>([]);

    // --- Smooth quantum cloud morphing ---
    const cloudMorphProgressRef = useRef<number>(bondingProgress);

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

            // --- Smoothly interpolate cloud morph progress toward bondingProgress ---
            cloudMorphProgressRef.current += (bondingProgress - cloudMorphProgressRef.current) * Math.min(1, delta * 4);

            if (animatedObjects.length === 0) {
                controlsRef.current.update();
                rendererRef.current.render(sceneRef.current, cameraRef.current);
                return;
            }

            moleculeCenter.set(0, 0, 0);
            if (animatedObjects.length > 0) {
                for (const obj of animatedObjects) {
                    moleculeCenter.add(obj.nucleus.position);
                }
                moleculeCenter.divideScalar(animatedObjects.length);
            }

            animatedObjects.forEach((obj, index) => {
                // --- Quantum cloud deformation: lean toward bonded atoms ---
                let cloudOffset = new THREE.Vector3(0, 0, 0);
                if (bondingPairs && bondingPairs.length > 0) {
                    bondingPairs.forEach(bond => {
                        if (bond.pair.includes(index)) {
                            const otherIdx = bond.pair[0] === index ? bond.pair[1] : bond.pair[0];
                            if (animatedObjects[otherIdx]) {
                                const dir = new THREE.Vector3().subVectors(animatedObjects[otherIdx].nucleus.position, obj.nucleus.position);
                                const dist = dir.length();
                                if (dist > 0.01) {
                                    dir.normalize();
                                    // Offset cloud toward bonded atom, scaled by proximity and cloudMorphProgress
                                    cloudOffset.add(dir.multiplyScalar(0.5 * cloudMorphProgressRef.current * Math.max(0, 1 - dist / 15)));
                                }
                            }
                        }
                    });
                }
                obj.shellPaths.forEach(shell => {
                    // Morph/merge quantum cloud toward bonded atom(s) as bond forms, with smooth interpolation
                    shell.position.copy(obj.nucleus.position.clone().add(cloudOffset));
                    if (shell.userData && typeof shell.userData.animateQuantumCloud === 'function') {
                        shell.userData.animateQuantumCloud(delta);
                        if (bondingPairs && bondingPairs.length > 0 && shell.geometry instanceof THREE.TorusKnotGeometry) {
                            bondingPairs.forEach(bond => {
                                if (bond.pair.includes(index)) {
                                    const otherIdx = bond.pair[0] === index ? bond.pair[1] : bond.pair[0];
                                    if (animatedObjects[otherIdx]) {
                                        const midpoint = new THREE.Vector3().addVectors(obj.nucleus.position, animatedObjects[otherIdx].nucleus.position).multiplyScalar(0.5);
                                        const morphAmount = cloudMorphProgressRef.current * 0.8;
                                        const posAttr = shell.geometry.attributes.position;
                                        // Store original positions for smooth morphing
                                        if (!shell.userData.origPositions) {
                                            shell.userData.origPositions = [];
                                            for (let i = 0; i < posAttr.count; i++) {
                                                const orig = new THREE.Vector3().fromBufferAttribute(posAttr, i);
                                                shell.userData.origPositions.push(orig.clone());
                                            }
                                        }
                                        for (let i = 0; i < posAttr.count; i++) {
                                            const orig = shell.userData.origPositions[i];
                                            const worldOrig = orig.clone().add(obj.nucleus.position);
                                            const target = worldOrig.clone().lerp(midpoint, morphAmount).sub(shell.position);
                                            // Smoothly interpolate current vertex toward target
                                            const current = new THREE.Vector3().fromBufferAttribute(posAttr, i);
                                            current.lerp(target, Math.min(1, delta * 8)); // Higher factor = faster, but still smooth
                                            posAttr.setXYZ(i, current.x, current.y, current.z);
                                        }
                                        posAttr.needsUpdate = true;
                                    }
                                }
                            });
                        }
                        (shell.material as THREE.MeshStandardMaterial).opacity = 0.13;
                    } else {
                        (shell.material as THREE.MeshBasicMaterial).opacity = 0.3;
                    }
                });
                obj.electronPivots.forEach((pivot, i) => {
                    orbitalCenter.lerpVectors(obj.nucleus.position, moleculeCenter, cloudMorphProgressRef.current);
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

    // Only rebuild the scene if the number of atoms or bonds changes, not on every position update
    useEffect(() => {
        if (!sceneRef.current || !modelGroupRef.current || !cameraRef.current || !rendererRef.current) {
            if (atoms.length === 0) setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setTimeout(() => {
            const modelGroup = modelGroupRef.current!;
            cleanupScene(modelGroup, animatedObjectsRef, bondsRef);
            const nucleiForDrag: THREE.Mesh[] = [];
            atoms.forEach((atom, index) => {
                // Start at current or target position
                const position = (currentAtomPositionsRef.current[index] || atomPositions[index] || new THREE.Vector3()).clone();
                const newObject = createAtomModel(atom, position, quantumMode);
                newObject.nucleus.userData = { symbol: atom.symbol, atomIndex: index };
                modelGroup.add(newObject.nucleus);
                newObject.shellPaths.forEach(p => modelGroup.add(p));
                newObject.electronPivots.forEach(p => modelGroup.add(p));
                animatedObjectsRef.current.push(newObject);
                nucleiForDrag.push(newObject.nucleus);
            });
            // Bonds (same as before)
            if (bondingPairs.length > 0 && atoms.length > 1) {
                // Dynamic bond visuals: color/thickness by type, opacity by proximity
                const bondTypeProps = {
                    single:   { color: 0xaaaaaa, thickness: BOND_RADIUS, glow: 0 },
                    double:   { color: 0x4fd1c5, thickness: BOND_RADIUS * 1.3, glow: 0.2 },
                    triple:   { color: 0xf6ad55, thickness: BOND_RADIUS * 1.6, glow: 0.3 },
                    ionic:    { color: 0x4299e1, thickness: BOND_RADIUS * 1.1, glow: 0.5 },
                    covalent: { color: 0x38a169, thickness: BOND_RADIUS * 1.2, glow: 0.2 },
                    polar:    { color: 0xed64a6, thickness: BOND_RADIUS * 1.2, glow: 0.4 },
                    nonpolar: { color: 0xf7fafc, thickness: BOND_RADIUS, glow: 0.1 },
                };
                bondingPairs.forEach(bondInfo => {
                    const { pair, type } = bondInfo;
                    if (pair.length !== 2) return;
                    const [indexA, indexB] = pair;
                    if (indexA < 0 || indexA >= atoms.length || indexB < 0 || indexB >= atoms.length) return;
                    const atomA = animatedObjectsRef.current[indexA];
                    const atomB = animatedObjectsRef.current[indexB];
                    if (!atomA || !atomB) return;
                    // Determine bond type props
                    const t = (typeof type === 'string' && bondTypeProps[type]) ? type : (type === 2 ? 'double' : type === 3 ? 'triple' : 'single');
                    const props = bondTypeProps[t] || bondTypeProps.single;
                    // Opacity/strength by proximity
                    const posA = atomA.nucleus.position;
                    const posB = atomB.nucleus.position;
                    const maxDist = 15; // baseRadius
                    const minDist = 2.5; // minRadius
                    const dist = posA.distanceTo(posB);
                    const bondStrength = Math.max(0, Math.min(1, 1 - (dist - minDist) / (maxDist - minDist)));
                    const bondColor = new THREE.Color(props.color).lerp(new THREE.Color(0x222222), 1 - bondStrength);
                    const bondMaterial = new THREE.MeshStandardMaterial({
                        color: bondColor,
                        metalness: 0.4,
                        roughness: 0.3,
                        transparent: true,
                        opacity: 0.15 + 0.85 * bondStrength,
                        emissive: bondColor,
                        emissiveIntensity: props.glow * bondStrength,
                    });
                    const bondGeometry = new THREE.CylinderGeometry(props.thickness, props.thickness, 1, 16);
                    const bondGroup = new THREE.Group();
                    bondGroup.userData = { pair, type };
                    if (t === 'single') {
                        const bondMesh = new THREE.Mesh(bondGeometry, bondMaterial);
                        bondGroup.add(bondMesh);
                    } else if (t === 'double') {
                        const bondMesh1 = new THREE.Mesh(bondGeometry, bondMaterial);
                        const bondMesh2 = new THREE.Mesh(bondGeometry, bondMaterial);
                        bondMesh1.position.set(0, DOUBLE_BOND_SPACING / 2, 0);
                        bondMesh2.position.set(0, -DOUBLE_BOND_SPACING / 2, 0);
                        bondGroup.add(bondMesh1, bondMesh2);
                    } else if (t === 'triple') {
                        const bondMesh1 = new THREE.Mesh(bondGeometry, bondMaterial);
                        const bondMesh2 = new THREE.Mesh(bondGeometry, bondMaterial);
                        const bondMesh3 = new THREE.Mesh(bondGeometry, bondMaterial);
                        bondMesh1.position.set(0, DOUBLE_BOND_SPACING / 2, 0);
                        bondMesh2.position.set(0, -DOUBLE_BOND_SPACING / 2, 0);
                        bondMesh3.position.set(0, 0, TRIPLE_BOND_SPACING / 2);
                        bondGroup.add(bondMesh1, bondMesh2, bondMesh3);
                    } else {
                        // For ionic, polar, nonpolar, covalent, etc. use a single thick/glowing bond
                        const bondMesh = new THREE.Mesh(bondGeometry, bondMaterial);
                        bondGroup.add(bondMesh);
                    }
                    modelGroup.add(bondGroup);
                    bondsRef.current.push(bondGroup);
                });
            }
            // Drag controls (same as before)
            if (dragControlsRef.current) dragControlsRef.current.dispose();
            const dragControls = new DragControls(nucleiForDrag, cameraRef.current, rendererRef.current.domElement);
            dragControls.enabled = true;
            dragControlsRef.current = dragControls;
            dragControls.addEventListener('dragstart', (event) => { event.object.material.emissiveIntensity = 1.0; event.object.material.color.offsetHSL(0, 0.2, 0); });
            dragControls.addEventListener('dragend', (event) => { event.object.material.emissiveIntensity = 0.2; });
            dragControls.addEventListener('drag', (event) => {
                const index = event.object.userData.atomIndex;
                if (index !== undefined) { onAtomPositionChange(index, event.object.position.clone()); }
            });
            // Initialize current positions for tweening
            currentAtomPositionsRef.current = atomPositions.map(p => p.clone());
            setIsLoading(false);
        }, 0);
    }, [atoms.length, bondingPairs.length, quantumMode, onAtomPositionChange, setIsLoading, atomPositions]);

    // Smoothly tween atom positions toward their targets every frame
    useEffect(() => {
        let animationFrame: number;
        function animatePositions() {
            if (!animatedObjectsRef.current.length) {
                animationFrame = requestAnimationFrame(animatePositions);
                return;
            }
            let needsUpdate = false;
            for (let i = 0; i < animatedObjectsRef.current.length; i++) {
                const obj = animatedObjectsRef.current[i];
                const target = atomPositions[i] || new THREE.Vector3();
                const current = obj.nucleus.position;
                // Lerp toward target (faster for less flicker)
                current.lerp(target, 0.35); // Increased speed for smoother animation
                if (current.distanceTo(target) > 0.01) needsUpdate = true;
            }
            if (needsUpdate && rendererRef.current && sceneRef.current && cameraRef.current) {
                rendererRef.current.render(sceneRef.current, cameraRef.current);
            }
            animationFrame = requestAnimationFrame(animatePositions);
        }
        animatePositions();

        return () => cancelAnimationFrame(animationFrame);
    }, [atomPositions]);

    return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />;
};

export default memo(AtomViewer);
