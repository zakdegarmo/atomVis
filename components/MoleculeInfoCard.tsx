
import React from 'react';
import type { MoleculeInfo } from '../types';
import { InfoIcon } from './Icons';

// A simple loading spinner
const Spinner: React.FC = () => (
    <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
);

interface MoleculeInfoCardProps {
    moleculeName: string | null;
    info: MoleculeInfo | null;
    loading: boolean;
    error: string | null;
    onClose: () => void;
}

const MoleculeInfoCard: React.FC<MoleculeInfoCardProps> = ({ moleculeName, info, loading, error, onClose }) => {
    return (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] transition-opacity duration-300"
            onClick={onClose}
            aria-modal="true"
            role="dialog"
        >
            <div 
                className="bg-gray-800/80 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg m-4 p-6 text-white transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale"
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside the card
            >
                <div className="flex justify-between items-center border-b border-gray-600 pb-3 mb-4">
                    <div className="flex items-center space-x-3">
                        <InfoIcon className="w-8 h-8 text-blue-400"/>
                        <h2 className="text-2xl font-bold tracking-wide">
                            {loading ? "Fetching Info..." : `About ${moleculeName}`}
                        </h2>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="text-gray-400 hover:text-white transition-colors rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-4">
                    {loading && (
                        <div className="flex justify-center items-center py-16">
                            <Spinner />
                        </div>
                    )}
                    {error && (
                        <div className="bg-red-900/50 border border-red-700 text-red-300 p-4 rounded-lg">
                            <h3 className="font-bold">Error</h3>
                            <p>{error}</p>
                        </div>
                    )}
                    {info && !loading && (
                        <div className="space-y-5 animate-fade-in">
                            <div>
                                <h3 className="text-lg font-semibold text-blue-300 mb-2">Summary</h3>
                                <p className="text-gray-300 leading-relaxed">{info.summary}</p>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-blue-300 mb-2">Common Uses</h3>
                                <ul className="list-disc list-inside space-y-1 text-gray-300">
                                    {info.commonUses.map((use, index) => (
                                        <li key={index}>{use}</li>
                                    ))}
                                </ul>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-blue-300 mb-2">Fun Fact</h3>
                                <p className="italic text-gray-300 bg-gray-700/50 p-3 rounded-md border-l-4 border-blue-400">{info.funFact}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
             <style>{`
                @keyframes fade-in-scale {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .animate-fade-in-scale {
                    animation: fade-in-scale 0.3s ease-out forwards;
                }
                 @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-fade-in {
                    animation: fade-in 0.5s ease-in-out forwards;
                }
            `}</style>
        </div>
    );
};

export default MoleculeInfoCard;
