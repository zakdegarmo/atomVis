
import React, { useRef, useEffect, useState } from 'react';
import type { Atom, Bond } from '../types';

interface ContextMenuProps {
  x: number;
  y: number;
  atomIndex: number;
  atoms: Atom[];
  bondingPairs: Bond[];
  onClose: () => void;
  onAddBond: (fromIndex: number, toIndex: number, type: 1 | 2 | 3) => void;
  onRemoveBonds: (atomIndex: number) => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, atomIndex, atoms, bondingPairs, onAddBond, onRemoveBonds, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const targetAtom = atoms[atomIndex];

  // Adjust position to stay in viewport
  useEffect(() => {
    if (menuRef.current) {
      const menuWidth = menuRef.current.offsetWidth;
      const menuHeight = menuRef.current.offsetHeight;
      let newX = x;
      let newY = y;
      if (x + menuWidth > window.innerWidth) {
        newX = window.innerWidth - menuWidth - 10;
      }
      if (y + menuHeight > window.innerHeight) {
        newY = window.innerHeight - menuHeight - 10;
      }
      setPosition({ x: newX, y: newY });
    }
  }, [x, y]);

  if (!targetAtom) return null;
  
  const hasBonds = bondingPairs.some(bond => bond.pair.includes(atomIndex));
  const otherAtoms = atoms.map((_, i) => i).filter(i => i !== atomIndex);

  return (
    <div
      ref={menuRef}
      className="absolute bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 text-white text-sm animate-fade-in-fast w-56"
      style={{ top: position.y, left: position.x }}
      onClick={(e) => e.stopPropagation()} // Prevent App-level click handler from closing immediately
      onContextMenu={(e) => e.preventDefault()} // Prevent stacking context menus
    >
      <div className="p-2 border-b border-gray-600">
        <h3 className="font-bold truncate">Atom {atomIndex + 1} ({targetAtom.name})</h3>
      </div>
      <ul className="py-1 max-h-48 overflow-y-auto divide-y divide-gray-700">
        {otherAtoms.length > 0 ? otherAtoms.map(index => {
          const existingBond = bondingPairs.find(b =>
              (b.pair[0] === atomIndex && b.pair[1] === index) || (b.pair[0] === index && b.pair[1] === atomIndex)
          );
          
          return (
            <li key={index} className="px-3 py-2" onContextMenu={(e) => e.preventDefault()}>
              <div className="flex justify-between items-center">
                  <span>Atom {index + 1} ({atoms[index].symbol})</span>
                  {existingBond ? (
                        <span className="text-xs font-semibold text-gray-400 bg-gray-700 px-2 py-1 rounded-md">
                            {existingBond.type === 3 ? 'Triple' : existingBond.type === 2 ? 'Double' : 'Single'} Bond
                        </span>
                  ) : (
                      <div className="flex space-x-1">
                          <button
                              onClick={() => onAddBond(atomIndex, index, 1)}
                              title="Create Single Bond"
                              className="text-xs font-bold px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
                          >
                              1x
                          </button>
                          <button
                              onClick={() => onAddBond(atomIndex, index, 2)}
                              title="Create Double Bond"
                              className="text-xs font-bold px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-400"
                          >
                              2x
                          </button>
                          <button
                            onClick={() => onAddBond(atomIndex, index, 3)}
                            title="Create Triple Bond"
                            className="text-xs font-bold px-2 py-1 rounded bg-red-600 hover:bg-red-500 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
                          >
                            3x
                          </button>
                      </div>
                  )}
              </div>
            </li>
          );
        }) : <li className="px-3 py-1.5 text-xs text-gray-500 italic">No other atoms to bond</li>}
      </ul>
      {(hasBonds) && <div className="border-t border-gray-600"></div>}
      {hasBonds && (
        <button
          className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-800/50 transition-colors rounded-b-lg"
          onClick={() => onRemoveBonds(atomIndex)}
        >
          Remove All Bonds
        </button>
      )}
      <style>{`
          @keyframes fade-in-fast {
              from { opacity: 0; transform: scale(0.98); }
              to { opacity: 1; transform: scale(1); }
          }
          .animate-fade-in-fast {
              animation: fade-in-fast 0.1s ease-out forwards;
          }
      `}</style>
    </div>
  );
};

export default ContextMenu;
