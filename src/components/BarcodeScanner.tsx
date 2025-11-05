import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

interface BarcodeScannerProps {
  onScan: (data: ScanResult) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
}

export interface ScanResult {
  barcode?: {
    value: string;
    format: string;
  };
  text?: string;
}

type CameraFacingMode = 'user' | 'environment';
type ScanMode = 'barcode-ocr' | 'ocr-only';

export function BarcodeScanner({ onScan, videoRef }: BarcodeScannerProps) {
  const [error, setError] = useState('');
  const [debugInfo, setDebugInfo] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>('environment'); // Default to back camera
  const [scanMode, setScanMode] = useState<ScanMode>('barcode-ocr'); // Default to barcode + OCR
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastBarcodeRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);
  const ocrIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    // Get available cameras
    navigator.mediaDevices.enumerateDevices()
      .then(devices => {
        const cameras = devices.filter(device => device.kind === 'videoinput');
        setAvailableCameras(cameras);
      })
      .catch(err => console.error('Error listing cameras:', err));
  }, []);

  useEffect(() => {
    startScanning();

    return () => {
      // Cleanup
      if (ocrIntervalRef.current) {
        clearInterval(ocrIntervalRef.current);
      }
    };
  }, [facingMode, scanMode]);

  const startScanning = async () => {
    try {
      setError('');
      setDebugInfo('📸 Starting camera...');

      // Clear any existing OCR interval
      if (ocrIntervalRef.current) {
        clearInterval(ocrIntervalRef.current);
        ocrIntervalRef.current = null;
      }

      // Stop any existing barcode scanner
      if (codeReaderRef.current) {
        codeReaderRef.current = null;
      }

      // Stop any existing video stream
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }

      // If OCR-only mode, start camera and OCR interval instead of barcode scanning
      if (scanMode === 'ocr-only') {
        await startOCROnlyMode();
        return;
      }

      // Barcode + OCR mode (original behavior)
      const codeReader = new BrowserMultiFormatReader();
      
      // Configure for SPEED - remove TRY_HARDER for instant scanning
      const hints = new Map();
      // Removed TRY_HARDER for speed - sacrifices difficult barcodes for speed
      hints.set(3, true); // PURE_BARCODE (ignore surrounding content)
      codeReader.hints = hints;
      
      codeReaderRef.current = codeReader;

      // Get video devices and select based on facing mode
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      let selectedDeviceId: string | undefined;
      
      if (videoDevices.length > 0) {
        // Try to find a camera matching the facing mode
        const backCamera = videoDevices.find(device => 
          device.label.toLowerCase().includes('back') || 
          device.label.toLowerCase().includes('rear') ||
          device.label.toLowerCase().includes('environment')
        );
        const frontCamera = videoDevices.find(device => 
          device.label.toLowerCase().includes('front') || 
          device.label.toLowerCase().includes('user') ||
          device.label.toLowerCase().includes('face')
        );
        
        if (facingMode === 'environment' && backCamera) {
          selectedDeviceId = backCamera.deviceId;
        } else if (facingMode === 'user' && frontCamera) {
          selectedDeviceId = frontCamera.deviceId;
        } else {
          // Fallback: use first camera for front, last for back
          selectedDeviceId = facingMode === 'environment' 
            ? videoDevices[videoDevices.length - 1].deviceId 
            : videoDevices[0].deviceId;
        }
      }

      await codeReader.decodeFromVideoDevice(
        selectedDeviceId,
        videoRef.current!,
        async (result) => {
          if (result) {
            const barcodeValue = result.getText();
            const barcodeFormat = result.getBarcodeFormat().toString();
            
            const now = Date.now();
            
            // Skip if this is the same barcode we just scanned (within 300ms)
            if (barcodeValue === lastBarcodeRef.current && now - lastScanTimeRef.current < 300) {
              return; // Skip immediate duplicates of same barcode
            }
            
            // Skip if we're currently processing this exact barcode
            if (isProcessing && barcodeValue === lastBarcodeRef.current) {
              return;
            }
            
            // Update references immediately
            lastBarcodeRef.current = barcodeValue;
            lastScanTimeRef.current = now;
            
            // Don't block on processing flag - allow new barcodes immediately
            const wasProcessing = isProcessing;
            setIsProcessing(true);
            
            // Show status immediately
            setDebugInfo(`⚡ ${barcodeValue}`);
            
            // Take screenshot
            const screenshot = captureFrame();
            
            if (!screenshot) {
              // Send result immediately without AI
              onScan({
                barcode: {
                  value: barcodeValue,
                  format: barcodeFormat
                },
                text: ''
              });
              setIsProcessing(false);
              setDebugInfo('👁️ Ready');
              return;
            }
            
            // Call AI for text extraction (don't await - let it run async)
            extractTextWithAI(screenshot).then(extractedText => {
              // Send result with extracted text
              onScan({
                barcode: {
                  value: barcodeValue,
                  format: barcodeFormat
                },
                text: extractedText || '(No text found)'
              });
              
              // Reset processing flag immediately for next scan
              setIsProcessing(false);
              setDebugInfo('👁️ Ready');
              
            }).catch(err => {
              console.error('AI extraction failed:', err);
              // Send result even on error
              onScan({
                barcode: {
                  value: barcodeValue,
                  format: barcodeFormat
                },
                text: '(AI extraction failed)'
              });
              setIsProcessing(false);
              setDebugInfo('👁️ Ready');
            });
          }
        }
      );

      setDebugInfo('👁️ Ready - Show barcode to camera');
    } catch (err: any) {
      console.error('Scanner error:', err);
      let errorMessage = 'Failed to start camera. ';
      
      if (err.name === 'NotAllowedError') {
        errorMessage += 'Please allow camera access in your browser settings.';
      } else if (err.name === 'NotFoundError') {
        errorMessage += 'No camera found on this device.';
      } else if (err.name === 'NotReadableError') {
        errorMessage += 'Camera is already in use by another application.';
      } else {
        errorMessage += err.message || 'Unknown error occurred.';
      }
      
      setError(errorMessage);
      setDebugInfo('Error: ' + errorMessage);
    }
  };

  const startOCROnlyMode = async () => {
    try {
      // Start camera without barcode scanning
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      let constraints: MediaStreamConstraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };

      // Try to use specific device if available
      if (videoDevices.length > 0) {
        const backCamera = videoDevices.find(device => 
          device.label.toLowerCase().includes('back') || 
          device.label.toLowerCase().includes('rear') ||
          device.label.toLowerCase().includes('environment')
        );
        const frontCamera = videoDevices.find(device => 
          device.label.toLowerCase().includes('front') || 
          device.label.toLowerCase().includes('user')
        );
        
        let selectedDevice;
        if (facingMode === 'environment' && backCamera) {
          selectedDevice = backCamera;
        } else if (facingMode === 'user' && frontCamera) {
          selectedDevice = frontCamera;
        } else {
          selectedDevice = facingMode === 'environment' 
            ? videoDevices[videoDevices.length - 1]
            : videoDevices[0];
        }

        if (selectedDevice) {
          constraints = {
            video: {
              deviceId: { exact: selectedDevice.deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            }
          };
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setDebugInfo('📸 OCR Mode - Click to scan or auto-scans every 3s');

      // No auto-scan - user will tap to scan
      setDebugInfo('📸 OCR Mode - Tap scan button');

    } catch (err: any) {
      console.error('OCR mode error:', err);
      let errorMessage = 'Failed to start OCR mode: ';
      
      if (err.name === 'NotAllowedError') {
        errorMessage += 'Please allow camera access.';
      } else if (err.name === 'NotFoundError') {
        errorMessage += 'No camera found.';
      } else if (err.name === 'NotReadableError') {
        errorMessage += 'Camera is in use.';
      } else {
        errorMessage += err.message;
      }
      
      setError(errorMessage);
      setDebugInfo('Error: ' + errorMessage);
    }
  };

  const performOCRScan = async () => {
    if (isProcessing) return;

    setIsProcessing(true);
    lastScanTimeRef.current = Date.now();
    setDebugInfo('🔍 AI reading text...');

    const screenshot = captureFrame();
    if (!screenshot) {
      setIsProcessing(false);
      setDebugInfo('❌ Failed to capture image');
      setTimeout(() => {
        setDebugInfo('📸 OCR Mode - Tap to scan');
      }, 2000);
      return;
    }

    try {
      const extractedText = await extractTextWithAI(screenshot);
      
      console.log('OCR Result:', extractedText); // Debug log
      
      if (extractedText && extractedText.trim() && extractedText !== 'NO_TEXT_FOUND') {
        onScan({
          text: extractedText
        });
        setDebugInfo('✅ Text extracted!');
        setTimeout(() => {
          setDebugInfo('📸 OCR Mode - Tap to scan');
        }, 1500);
      } else {
        setDebugInfo('⚠️ No text detected - Point at clear text');
        setTimeout(() => {
          setDebugInfo('📸 OCR Mode - Tap to scan');
        }, 2000);
      }
    } catch (err) {
      console.error('OCR failed:', err);
      setDebugInfo('❌ OCR failed - Try again');
      setTimeout(() => {
        setDebugInfo('📸 OCR Mode - Tap to scan');
      }, 2000);
    } finally {
      setIsProcessing(false);
    }
  };

  const captureFrame = (): string | null => {
    if (!videoRef.current) return null;

    try {
      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) return null;
      
      // Draw original image
      ctx.drawImage(video, 0, 0);
      
      // FAST image enhancement - simplified for speed
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Fixed enhancement values for speed (no brightness calculation)
      const brightnessBoost = 30;
      const contrastMultiplier = 1.4;
      
      // Quick contrast/brightness adjustment
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.max(0, Math.min(255, ((data[i] - 128) * contrastMultiplier) + 128 + brightnessBoost));
        data[i + 1] = Math.max(0, Math.min(255, ((data[i + 1] - 128) * contrastMultiplier) + 128 + brightnessBoost));
        data[i + 2] = Math.max(0, Math.min(255, ((data[i + 2] - 128) * contrastMultiplier) + 128 + brightnessBoost));
      }
      
      // Put enhanced image back (skip sharpening for speed)
      ctx.putImageData(imageData, 0, 0);
      
      // High quality JPEG
      return canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
    } catch (err) {
      console.error('Frame capture error:', err);
      return null;
    }
  };

  const extractTextWithAI = async (base64Image: string): Promise<string> => {
    try {
      // Call OpenRouter API
      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
      
      if (!apiKey) {
        console.warn('OpenRouter API key not configured');
        return '';
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.href,
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'You are an expert OCR system. Extract ALL text visible in this image. Read everything - words, numbers, labels, signs, product names, brands, prices, dates, addresses, handwriting, printed text, etc. Even if text is blurry, tilted, small, faded, or partially obscured - do your best to read it. Format the output as plain text, preserving line breaks where appropriate. If you see NOTHING readable at all, return the text "NO_TEXT_FOUND".'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          max_tokens: 500,
          temperature: 0.1
        })
      });

      const data = await response.json();
      
      console.log('AI Text Extraction response:', data);
      
      if (data.error) {
        console.error('AI API Error:', data.error);
        return '';
      }
      
      if (data.choices && data.choices[0]?.message?.content) {
        const text = data.choices[0].message.content.trim();
        
        // Check if AI found no text
        if (text === 'NO_TEXT_FOUND' || text === '') {
          return '';
        }
        
        return text;
      }
      
      return '';
    } catch (err) {
      console.error('Text extraction error:', err);
      return '';
    }
  };

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  const toggleScanMode = () => {
    setScanMode(prev => prev === 'barcode-ocr' ? 'ocr-only' : 'barcode-ocr');
  };

  return (
    <div className="scanner-container">
      <video 
        ref={videoRef} 
        className="scanner-video"
        playsInline
        autoPlay
        muted
      />
      <div className="scanner-overlay">
        <div className="scanner-frame">
          <div className="corner top-left"></div>
          <div className="corner top-right"></div>
          <div className="corner bottom-left"></div>
          <div className="corner bottom-right"></div>
          <div className="scan-line"></div>
        </div>
      </div>
      <button 
        className="mode-toggle-btn" 
        onClick={toggleScanMode}
        aria-label="Toggle scan mode"
        title={scanMode === 'barcode-ocr' ? 'Switch to OCR Only' : 'Switch to Barcode + OCR'}
      >
        {scanMode === 'barcode-ocr' ? '📊' : '📝'}
      </button>
      {availableCameras.length > 1 && (
        <button 
          className="camera-switch-btn" 
          onClick={toggleCamera}
          aria-label="Switch camera"
        >
          🔄
        </button>
      )}
      {scanMode === 'ocr-only' && (
        <button 
          className="ocr-scan-btn" 
          onClick={performOCRScan}
          disabled={isProcessing}
          aria-label="Scan text"
        >
          {isProcessing ? '⏳' : '📸'}
        </button>
      )}
      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}
      <div className="debug-info">
        {isProcessing && <span className="processing-spinner">⏳ </span>}
        {debugInfo}
      </div>
      <div className="mode-indicator">
        {scanMode === 'barcode-ocr' ? '📊 Barcode + OCR' : '📝 OCR Only'}
      </div>
    </div>
  );
}
