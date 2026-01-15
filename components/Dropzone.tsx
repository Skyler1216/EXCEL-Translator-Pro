import React, { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';

interface DropzoneProps {
  onFileAccepted: (file: File) => void;
  disabled?: boolean;
}

export const Dropzone: React.FC<DropzoneProps> = ({ onFileAccepted, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const validateAndAccept = (file: File) => {
    if (!file.name.endsWith('.xlsx')) {
      setError('Please upload a valid .xlsx file');
      setFileName(null);
      return;
    }
    setError(null);
    setFileName(file.name);
    onFileAccepted(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndAccept(e.dataTransfer.files[0]);
    }
  }, [disabled, onFileAccepted]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndAccept(e.target.files[0]);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ease-in-out
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <input
          type="file"
          accept=".xlsx"
          onChange={handleInputChange}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        
        <div className="flex flex-col items-center justify-center space-y-4">
          {fileName ? (
            <div className="flex items-center space-x-3 text-green-600 bg-green-50 px-4 py-2 rounded-lg">
              <FileSpreadsheet className="w-8 h-8" />
              <span className="font-medium truncate max-w-[200px]">{fileName}</span>
              <CheckCircle className="w-5 h-5" />
            </div>
          ) : (
            <>
              <div className={`p-4 rounded-full ${isDragging ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                <Upload className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-medium text-gray-700">
                  {isDragging ? 'Drop file here' : 'Click or drag file to upload'}
                </p>
                <p className="text-sm text-gray-500">Supports .xlsx (Excel files)</p>
              </div>
            </>
          )}
          
          {error && (
            <div className="flex items-center space-x-2 text-red-500 bg-red-50 px-3 py-1 rounded text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};