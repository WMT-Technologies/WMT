'use client';

import React, { useState } from 'react';
import { AnalysisResult, ExtractedData, SaveAnalysisResponse, ApiError } from '../types/analysis';

interface AnalysisPreviewProps {
  analysis: AnalysisResult;
  userId: string;
  onSave?: (response: SaveAnalysisResponse) => void;
  onCancel?: () => void;
}

export default function AnalysisPreview({
  analysis,
  userId,
  onSave,
  onCancel,
}: AnalysisPreviewProps) {
  const [editedData, setEditedData] = useState<ExtractedData>(analysis.extractedData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);

  const handleFieldChange = (key: string, value: any) => {
    setEditedData({
      ...editedData,
      [key]: value,
    });
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/save-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          analysisId: analysis.id,
          approvedData: editedData,
          notes,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as ApiError;
        throw new Error(errorData.error || 'Failed to save');
      }

      const result = (await response.json()) as SaveAnalysisResponse;
      setSaved(true);

      if (onSave) {
        onSave(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  if (saved) {
    return (
      <div className="w-full max-w-2xl mx-auto p-6 bg-white rounded-lg shadow">
        <div className="flex items-center justify-center mb-4">
          <svg
            className="w-12 h-12 text-green-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-center mb-2">Analysis Saved Successfully</h2>
        <p className="text-gray-600 text-center mb-4">
          The extracted data has been saved to your WMT database.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-4">Review Extracted Data</h2>

      <div className="mb-6 p-4 bg-blue-50 rounded">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-semibold">Document Type:</span>
            <p className="text-gray-700">{analysis.detectedType}</p>
          </div>
          <div>
            <span className="font-semibold">Confidence:</span>
            <p className="text-gray-700">{(analysis.confidence * 100).toFixed(1)}%</p>
          </div>
          <div>
            <span className="font-semibold">AI Provider:</span>
            <p className="text-gray-700">
              {analysis.analysisMetadata.aiProvider.replace('_', ' ')}
            </p>
          </div>
          <div>
            <span className="font-semibold">Suggested Action:</span>
            <p className="text-gray-700">{analysis.suggestedAction}</p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="font-semibold mb-4">Extracted Data (Edit as needed):</h3>
        <div className="space-y-4">
          {Object.entries(editedData).map(([key, value]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {key}
              </label>
              <input
                type="text"
                value={String(value || '')}
                onChange={(e) => handleFieldChange(key, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded"
              />
            </div>
          ))}
        </div>
      </div>

      {analysis.confidence < 0.7 && (
        <div className="mb-6 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
          ⚠️ Low confidence score. Please review the extracted data carefully before saving.
        </div>
      )}

      {error && (
        <div className="mb-6 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Saving...' : 'Save & Approve'}
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 disabled:cursor-not-allowed transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
