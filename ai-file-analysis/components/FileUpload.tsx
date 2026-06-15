'use client';

import React, { useState, useRef } from 'react';
import { AnalysisResult, ApiError } from '../types/analysis';

interface FileUploadProps {
  onAnalysisComplete?: (result: AnalysisResult) => void;
  userId: string;
  acceptedFormats?: string;
}

export default function FileUpload({
  onAnalysisComplete,
  userId,
  acceptedFormats = '.pdf,.doc,.docx,.xlsx,.jpg,.jpeg,.png,.gif',
}: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.classList.add('border-blue-500', 'bg-blue-50');
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50');
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      setFile(droppedFile);
      setError(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      setError('Please select a file');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError('File size must be less than 20MB');
      return;
    }

    setLoading(true);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setProgress(Math.round(percentComplete));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          const result = JSON.parse(xhr.responseText) as AnalysisResult;
          setFile(null);
          setProgress(0);
          setError(null);
          if (onAnalysisComplete) {
            onAnalysisComplete(result);
          }
        } else {
          const errorData = JSON.parse(xhr.responseText) as ApiError;
          setError(errorData.error || 'Upload failed');
          setProgress(0);
        }
        setLoading(false);
      });

      xhr.addEventListener('error', () => {
        setError('Upload failed');
        setProgress(0);
        setLoading(false);
      });

      xhr.open('POST', '/api/analyze');
      xhr.setRequestHeader('x-user-id', userId);
      xhr.send(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(0);
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-4">Upload Document for Analysis</h2>

      <form onSubmit={handleUpload}>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition"
        >
          <svg
            className="w-12 h-12 mx-auto text-gray-400 mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          <p className="text-gray-600">
            {file ? `Selected: ${file.name}` : 'Drag and drop your file here, or click to select'}
          </p>
          {file && <p className="text-sm text-gray-500 mt-2">{(file.size / 1024).toFixed(2)} KB</p>}

          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedFormats}
            onChange={handleFileChange}
            className="hidden"
            disabled={loading}
          />
        </div>

        {loading && progress > 0 && (
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-gray-600 mt-2">{progress}% uploaded</p>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!file || loading}
          className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
        >
          {loading ? `Analyzing... ${progress}%` : 'Analyze File'}
        </button>
      </form>

      <div className="mt-6 p-4 bg-gray-50 rounded">
        <h3 className="font-semibold text-sm mb-2">Supported Formats:</h3>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>✓ Images: JPG, PNG, GIF</li>
          <li>✓ Documents: PDF, Word, Excel</li>
          <li>✓ Max file size: 20MB</li>
        </ul>
      </div>
    </div>
  );
}
