import React, { useState } from 'react';
import saveAs from 'file-saver';
import { Dropzone } from './components/Dropzone';
import { ExcelProcessor } from './services/excelService';
import { translateBatch } from './services/geminiService';
import { TranslationProgress } from './types';
import { FileDown, Loader2, Sparkles, AlertTriangle, AlertOctagon, RotateCcw, Download } from 'lucide-react';

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<TranslationProgress>({ 
    status: 'idle', 
    currentChunk: 0, 
    totalChunks: 0 
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [partialFile, setPartialFile] = useState<{blob: Blob, name: string} | null>(null);

  const handleFileAccepted = (acceptedFile: File) => {
    setFile(acceptedFile);
    setProgress({ status: 'idle', currentChunk: 0, totalChunks: 0 });
    setPartialFile(null);
  };

  const processFile = async () => {
    if (!file) return;

    setIsProcessing(true);
    setPartialFile(null);
    setProgress({ status: 'parsing', currentChunk: 0, totalChunks: 0, message: 'Reading Excel file...' });

    let processor: ExcelProcessor | null = null;

    try {
      processor = new ExcelProcessor();
      
      // 1. Load File
      await processor.loadFile(file);
      
      // 2. Extract Strings (Cells + Drawings)
      setProgress({ status: 'parsing', currentChunk: 0, totalChunks: 0, message: 'Extracting text (Cells & Text Boxes)...' });
      await processor.extractStrings();

      // 3. Translate Content
      await processor.processTranslations((newProgress) => {
        setProgress(newProgress);
      });

      // 4. Translate Filename
      setProgress({ status: 'translating', currentChunk: 0, totalChunks: 0, message: 'Translating filename...' });
      let finalFileName = `translated_${file.name}`;
      
      try {
        const [translatedName] = await translateBatch([file.name]);
        if (translatedName) {
          finalFileName = translatedName.trim();
          if (!finalFileName.toLowerCase().endsWith('.xlsx')) {
            if (!finalFileName.includes('.')) {
                finalFileName += '.xlsx';
            } else {
                finalFileName = finalFileName.replace(/\.[^/.]+$/, "") + ".xlsx";
            }
          }
        }
      } catch (error) {
        console.warn("Filename translation failed, falling back to prefix.", error);
      }

      // 5. Apply & Rebuild
      setProgress({ status: 'rebuilding', currentChunk: 0, totalChunks: 0, message: 'Applying translations and preserving styles...' });
      
      const buffer = await processor.getDownloadBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      
      saveAs(blob, finalFileName);
      
      setProgress({ status: 'complete', currentChunk: 0, totalChunks: 0, message: 'Done! Download started.' });

    } catch (error: any) {
      console.error(error);
      const isQuotaError = error.message.includes('Quota') || error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED');
      
      // Attempt to save partial result
      if (processor) {
        try {
          const buffer = await processor.getDownloadBuffer();
          const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          setPartialFile({ 
            blob, 
            name: `partial_${file.name.replace(/\.[^/.]+$/, "")}.xlsx` 
          });
        } catch (genError) {
          console.error("Failed to generate partial file:", genError);
        }
      }

      setProgress({ 
        status: 'error', 
        currentChunk: 0, 
        totalChunks: 0, 
        message: isQuotaError ? 'API Limit Exceeded' : 'Processing Error',
        error: isQuotaError 
          ? "You have exceeded the API daily quota. Don't worry, you can download the partial translation below."
          : (error.message || 'An error occurred during processing. Please try again.')
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center p-3 bg-blue-600 rounded-2xl shadow-lg mb-4">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-2">
            Excel Translator Pro
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Upload your Japanese Design Documents (.xlsx). We'll use Gemini AI to translate them to English while preserving your layout and styles.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
          <div className="p-8 sm:p-10 space-y-8">
            
            {/* Warning / Note */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
               <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
               <div className="text-sm text-amber-800">
                 <p className="font-semibold">Important:</p>
                 <ul className="list-disc list-inside mt-1 space-y-1">
                   <li>This tool runs entirely in your browser. Your data is sent to Gemini for translation but not stored on our servers.</li>
                   <li>Complex shapes and text boxes might have limited support depending on browser capabilities.</li>
                   <li>Large files may take a minute to process.</li>
                 </ul>
               </div>
            </div>

            {/* Upload Area */}
            <Dropzone onFileAccepted={handleFileAccepted} disabled={isProcessing} />

            {/* Action Area */}
            {file && (
              <div className="animate-fade-in flex flex-col items-center justify-center space-y-6">
                
                {/* Progress Bar */}
                {isProcessing && (
                  <div className="w-full max-w-xl space-y-2">
                    <div className="flex justify-between text-sm font-medium text-gray-600">
                      <span>{progress.message}</span>
                      {progress.totalChunks > 0 && (
                        <span>{Math.round((progress.currentChunk / progress.totalChunks) * 100)}%</span>
                      )}
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out" 
                        style={{ width: `${progress.totalChunks > 0 ? (progress.currentChunk / progress.totalChunks) * 100 : 0}%` }}
                      >
                        {progress.status === 'parsing' && (
                          <div className="animate-pulse w-full h-full bg-blue-400 opacity-75"></div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Status Messages */}
                {progress.status === 'complete' && (
                   <div className="flex items-center space-x-2 text-green-600 bg-green-50 px-6 py-3 rounded-full font-medium">
                     <CheckCircleIcon className="w-5 h-5" />
                     <span>Translation Complete! Check your downloads.</span>
                   </div>
                )}

                {/* Error Message */}
                {progress.status === 'error' && (
                  <div className="w-full max-w-xl p-4 bg-red-50 border border-red-200 rounded-lg flex flex-col items-start space-y-3">
                    <div className="flex items-start space-x-3">
                      <AlertOctagon className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-red-800 font-semibold">{progress.message}</h4>
                        <p className="text-sm text-red-600 mt-1">{progress.error}</p>
                      </div>
                    </div>

                    {/* Partial Download Button inside Error Box */}
                    {partialFile && (
                      <div className="w-full mt-2 pl-9">
                        <button
                          onClick={() => saveAs(partialFile.blob, partialFile.name)}
                          className="flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-amber-800 bg-amber-100 border border-amber-200 rounded-lg hover:bg-amber-200 transition-colors"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download Partial Result ({partialFile.name})
                        </button>
                        <p className="text-xs text-gray-500 mt-1">
                          Some text might not be translated, but you won't lose your progress.
                        </p>
                      </div>
                    )}
                    
                    <button 
                       onClick={() => processFile()} 
                       className="pl-9 mt-1 text-sm font-medium text-red-700 hover:text-red-900 underline flex items-center"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" /> Try Again
                    </button>
                  </div>
                )}

                {/* Process Button */}
                {!isProcessing && progress.status !== 'complete' && progress.status !== 'error' && (
                  <button
                    onClick={processFile}
                    className="group relative inline-flex items-center justify-center px-8 py-3 text-base font-semibold text-white transition-all duration-200 bg-blue-600 rounded-full hover:bg-blue-700 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="mr-2">Translate Document</span>
                    <FileDown className="w-5 h-5 group-hover:translate-y-1 transition-transform" />
                  </button>
                )}

                {/* Processing State Button (Disabled) */}
                {isProcessing && (
                  <button disabled className="inline-flex items-center justify-center px-8 py-3 text-base font-semibold text-blue-600 bg-blue-50 rounded-full cursor-wait">
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Processing...
                  </button>
                )}
                
                 {/* Reset Button (After completion or error) */}
                 {(progress.status === 'complete' || progress.status === 'error') && (
                  <button
                    onClick={() => {
                        setFile(null);
                        setProgress({ status: 'idle', currentChunk: 0, totalChunks: 0 });
                        setPartialFile(null);
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700 underline"
                  >
                    Translate another file
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper for check circle icon used in local scope
const CheckCircleIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
    <polyline points="22 4 12 14.01 9 11.01"></polyline>
  </svg>
);

export default App;