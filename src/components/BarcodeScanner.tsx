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

export function BarcodeScanner({ onScan, videoRef }: BarcodeScannerProps) {
  const [error, setError] = useState('');
  const [debugInfo, setDebugInfo] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>('environment'); // Default to back camera
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastBarcodeRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);
  const processedBarcodesRef = useRef<Set<string>>(new Set());

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
      // Cleanup handled by ZXing
    };
  }, [facingMode]);

  const startScanning = async () => {
    try {
      setError('');
      setDebugInfo('📸 Starting camera...');

      const codeReader = new BrowserMultiFormatReader();
      
      // Configure for better barcode detection
      const hints = new Map();
      hints.set(2, true); // TRY_HARDER mode for difficult barcodes
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
            
            // Skip if we're already processing OR if this barcode was recently scanned
            if (isProcessing) {
              return;
            }
            
            // Check if we already processed this exact barcode recently (within 5 seconds)
            if (barcodeValue === lastBarcodeRef.current && now - lastScanTimeRef.current < 5000) {
              return; // Skip duplicate
            }
            
            // Check if this barcode was already fully processed
            if (processedBarcodesRef.current.has(barcodeValue)) {
              return; // Already processed, skip
            }
            
            // Mark as processing to prevent concurrent scans
            setIsProcessing(true);
            lastBarcodeRef.current = barcodeValue;
            lastScanTimeRef.current = now;
            
            // Show status but DON'T call onScan yet
            setDebugInfo(`✅ Barcode: ${barcodeValue} - Extracting text...`);
            
            // Take screenshot
            const screenshot = captureFrame();
            
            if (!screenshot) {
              // Only call onScan ONCE with final result
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
            
            // Call AI ONCE for this barcode
            try {
              const extractedText = await extractTextWithAI(screenshot);
              
              // Mark this barcode as fully processed
              processedBarcodesRef.current.add(barcodeValue);
              
              // Call onScan ONLY ONCE with complete result
              onScan({
                barcode: {
                  value: barcodeValue,
                  format: barcodeFormat
                },
                text: extractedText || '(No text found)'
              });
              
              setDebugInfo('✨ Complete!');
              
              // Clear from processed set after 10 seconds to allow re-scanning later
              setTimeout(() => {
                processedBarcodesRef.current.delete(barcodeValue);
              }, 10000);
              
            } catch (err) {
              console.error('AI extraction failed:', err);
              // Only call onScan ONCE even on error
              onScan({
                barcode: {
                  value: barcodeValue,
                  format: barcodeFormat
                },
                text: '(AI extraction failed)'
              });
            } finally {
              setIsProcessing(false);
              setTimeout(() => {
                setDebugInfo('👁️ Ready');
              }, 1500);
            }
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
      
      // Apply image enhancements for better quality
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Increase contrast and brightness for poor lighting
      const contrast = 1.3; // 30% more contrast
      const brightness = 20; // Increase brightness
      
      for (let i = 0; i < data.length; i += 4) {
        // Apply contrast
        data[i] = ((data[i] - 128) * contrast) + 128 + brightness;     // Red
        data[i + 1] = ((data[i + 1] - 128) * contrast) + 128 + brightness; // Green
        data[i + 2] = ((data[i + 2] - 128) * contrast) + 128 + brightness; // Blue
        
        // Clamp values to 0-255
        data[i] = Math.max(0, Math.min(255, data[i]));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1]));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2]));
      }
      
      // Put enhanced image back
      ctx.putImageData(imageData, 0, 0);
      
      // Use higher quality for better recognition
      return canvas.toDataURL('image/jpeg', 0.98).split(',')[1];
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
                  text: 'Extract ALL visible text from this image. Focus on: product names, descriptions, brand names, labels, or any text near the barcode. Return ONLY the extracted text as plain text. If no text visible, return empty string.'
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
          max_tokens: 300,
          temperature: 0
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
      {availableCameras.length > 1 && (
        <button 
          className="camera-switch-btn" 
          onClick={toggleCamera}
          aria-label="Switch camera"
        >
          🔄
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
    </div>
  );
}
