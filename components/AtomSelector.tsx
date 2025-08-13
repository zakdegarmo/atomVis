
import React from 'react';
import type { ElementInfo } from '../types';

interface AtomSelectorProps {
  id: string;
  elements: ElementInfo[];
  selectedSymbol: string;
  index: number;
  onAtomChange: (index: number, symbol: string) => void;
}

const AtomSelector: React.FC<AtomSelectorProps> = ({ id, elements, selectedSymbol, index, onAtomChange }) => {
  return (
    <select
      id={id}
      value={selectedSymbol}
      onChange={(e) => onAtomChange(index, e.target.value)}
      className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
      aria-label="Select an element"
    >
      {elements.map((el) => (
        <option key={el.symbol} value={el.symbol}>
          {el.number}. {el.name} ({el.symbol})
        </option>
      ))}
    </select>
  );
};

export default AtomSelector;
