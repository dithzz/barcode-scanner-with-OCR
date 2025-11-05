import { useState, useRef } from 'react';
import { BarcodeScanner } from './components/BarcodeScanner';
import type { ScanResult } from './components/BarcodeScanner';
import './App.css';

interface DisplayResult extends ScanResult {
  timestamp: Date;
}

function App() {
  const [scanResults, setScanResults] = useState<DisplayResult[]>([]);
  const [lastResult, setLastResult] = useState<string>('');
  const [lastScanTime, setLastScanTime] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleScan = (result: ScanResult) => {
    const now = Date.now();
    const COOLDOWN = 3000; // 3 seconds between duplicate scans
    
    const resultKey = result.barcode?.value || result.text || '';
    
    // Prevent duplicate scans within cooldown period
    if (resultKey === lastResult && now - lastScanTime < COOLDOWN) {
      return; // Ignore duplicate
    }
    
    setLastResult(resultKey);
    setLastScanTime(now);
    
    const newResult: DisplayResult = {
      ...result,
      timestamp: new Date()
    };
    
    setScanResults(prev => [newResult, ...prev.slice(0, 9)]); // Keep last 10 results
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const clearResults = () => {
    setScanResults([]);
    setLastResult('');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🤖 AI Barcode Scanner</h1>
        <p>Powered by OpenRouter AI Vision - Barcode detection & OCR text extraction</p>
        <div className="instructions">
          � Barcode + OCR: Detect barcodes & extract text | 📝 OCR Only: Extract text without barcodes
        </div>
      </header>

      <main className="app-main">
        <BarcodeScanner 
          onScan={handleScan} 
          videoRef={videoRef as React.RefObject<HTMLVideoElement>} 
        />

        {scanResults.length > 0 && (
          <div className="results-section">
            <div className="results-header">
              <h2>Scan Results</h2>
              <button onClick={clearResults} className="clear-btn">
                Clear All
              </button>
            </div>
            
            <div className="results-list">
              {scanResults.map((result, index) => (
                <div key={index} className="result-card">
                  <div className="result-header">
                    <span className="result-format">
                      🤖 AI Scan Result
                    </span>
                    <span className="result-time">
                      {result.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  
                  {result.barcode && (
                    <div className="barcode-section">
                      <div className="section-title">📊 Barcode</div>
                      <div className="result-text">
                        <strong>Value:</strong> {result.barcode.value}
                      </div>
                      <div className="result-format-detail">
                        <strong>Format:</strong> {result.barcode.format}
                      </div>
                      <button
                        onClick={() => copyToClipboard(result.barcode!.value)}
                        className="copy-btn"
                      >
                        📋 Copy Barcode
                      </button>
                    </div>
                  )}
                  
                  {result.text && (
                    <div className="text-section">
                      <div className="section-title">📝 Extracted Text</div>
                      <div className="result-text">{result.text}</div>
                      <button
                        onClick={() => copyToClipboard(result.text!)}
                        className="copy-btn"
                      >
                        📋 Copy Text
                      </button>
                    </div>
                  )}
                  
                  <details className="json-details">
                    <summary>View JSON</summary>
                    <pre className="json-view">
                      {JSON.stringify({ 
                        barcode: result.barcode, 
                        text: result.text 
                      }, null, 2)}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(JSON.stringify({ 
                        barcode: result.barcode, 
                        text: result.text 
                      }, null, 2))}
                      className="copy-btn"
                    >
                      📋 Copy JSON
                    </button>
                  </details>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>📊 Barcodes: EAN, UPC, Code 128, QR Code, and more | 📝 OCR: Automatic text recognition</p>
      </footer>
    </div>
  );
}

export default App;
