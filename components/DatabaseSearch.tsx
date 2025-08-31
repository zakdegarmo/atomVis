import React, { useState, useCallback } from 'react';
import { parseSDF, parsePDB } from '../utils/parsers';
import type { ParsedMoleculeData } from '../types';

interface DatabaseSearchProps {
    onMoleculeLoad: (data: ParsedMoleculeData | null) => void;
    setIsSearching: (isSearching: boolean) => void;
}

const DatabaseSearch: React.FC<DatabaseSearchProps> = ({ onMoleculeLoad, setIsSearching }) => {
    const [query, setQuery] = useState('Aspirin');
    const [database, setDatabase] = useState<'pubchem' | 'pdb'>('pubchem');
    const [error, setError] = useState<string | null>(null);

    const fetchPubChemData = useCallback(async (name: string): Promise<string> => {
        const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/SDF?record_type=3d`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Molecule "${name}" not found in PubChem.`);
        }
        return response.text();
    }, []);

    const fetchPDBData = useCallback(async (pdbId: string): Promise<string> => {
        if (!/^[a-zA-Z0-9]{4}$/.test(pdbId)) {
             throw new Error('PDB ID must be 4 characters long.');
        }
        const url = `https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Molecule "${pdbId}" not found in PDB.`);
        }
        return response.text();
    }, []);

    const handleSearch = useCallback(async () => {
        if (!query.trim()) {
            setError('Please enter a molecule name or ID.');
            return;
        }
        setError(null);
        setIsSearching(true);
        onMoleculeLoad(null); // Clear previous molecule

        try {
            let parsedData: ParsedMoleculeData;
            if (database === 'pubchem') {
                const sdfData = await fetchPubChemData(query);
                parsedData = parseSDF(sdfData, query);
            } else {
                const pdbData = await fetchPDBData(query);
                parsedData = parsePDB(pdbData, query);
            }
            onMoleculeLoad(parsedData);
        } catch (err) {
            console.error(err);
            const message = err instanceof Error ? err.message : 'An unknown error occurred.';
            setError(message);
        } finally {
            setIsSearching(false);
        }
    }, [query, database, setIsSearching, onMoleculeLoad, fetchPubChemData, fetchPDBData]);


    return (
        <div className="p-3 bg-gray-800/70 rounded-md border border-gray-600 space-y-3">
            <h2 className="text-lg font-semibold text-orange-300 border-b border-gray-600 pb-2 mb-2">
                Load from Database
            </h2>
            <div className="space-y-2">
                <div className="flex items-center justify-center bg-gray-700 rounded-full p-1">
                    <button
                        onClick={() => setDatabase('pubchem')}
                        className={`w-1/2 px-3 py-1 text-xs font-bold rounded-full transition-colors ${database === 'pubchem' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-gray-600'}`}
                        aria-pressed={database === 'pubchem'}
                    >
                        PubChem
                    </button>
                    <button
                        onClick={() => setDatabase('pdb')}
                        className={`w-1/2 px-3 py-1 text-xs font-bold rounded-full transition-colors ${database === 'pdb' ? 'bg-purple-500 text-white' : 'text-gray-400 hover:bg-gray-600'}`}
                        aria-pressed={database === 'pdb'}
                    >
                        PDB
                    </button>
                </div>

                <div className="flex space-x-2">
                    <input
                        type="text"
                        id="db-search-input"
                        placeholder={database === 'pubchem' ? 'e.g., Caffeine, Water' : 'e.g., 1PGA (4-char ID)'}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            if (error) setError(null);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                        className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block w-full p-2.5"
                    />
                    <button
                        onClick={handleSearch}
                        className="px-4 py-2 bg-orange-600 text-white text-sm font-bold rounded-lg hover:bg-orange-500 transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-opacity-75"
                    >
                        Load
                    </button>
                </div>
                 {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
                 <p className="text-xs text-gray-500">
                    {database === 'pubchem' 
                        ? 'Search PubChem for small molecules by name.'
                        : 'Load macromolecules from the Protein Data Bank by their 4-character ID.'
                    }
                </p>
            </div>
        </div>
    );
};

export default DatabaseSearch;
