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
      
      // Configure for MAXIMUM barcode detection - work with ANY quality
      const hints = new Map();
      hints.set(2, true); // TRY_HARDER mode
      hints.set(3, true); // PURE_BARCODE (ignore surrounding content)
      hints.set(4, true); // ASSUME_GS1 (support GS1 barcodes)
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
            
            // Skip if this is the same barcode we just scanned (within 1 second)
            if (barcodeValue === lastBarcodeRef.current && now - lastScanTimeRef.current < 1000) {
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
            setDebugInfo(`✅ ${barcodeValue} - Extracting text...`);
            
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
              
              setDebugInfo('✨ Complete!');
              
              // Reset processing flag immediately
              setIsProcessing(false);
              
              setTimeout(() => {
                setDebugInfo('👁️ Ready');
              }, 500);
              
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
      
      // Apply aggressive image enhancements for ANY quality
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // Step 1: Calculate average brightness to auto-adjust
      let totalBrightness = 0;
      for (let i = 0; i < data.length; i += 4) {
        totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      const avgBrightness = totalBrightness / (data.length / 4);
      
      // Step 2: Auto-adjust based on image brightness
      // If image is dark (< 100), boost more. If bright (> 150), boost less.
      const brightnessBoost = avgBrightness < 100 ? 40 : avgBrightness > 150 ? 10 : 25;
      const contrastMultiplier = avgBrightness < 100 ? 1.5 : 1.3;
      
      // Step 3: Apply adaptive enhancement
      for (let i = 0; i < data.length; i += 4) {
        // Apply contrast and brightness
        data[i] = ((data[i] - 128) * contrastMultiplier) + 128 + brightnessBoost;
        data[i + 1] = ((data[i + 1] - 128) * contrastMultiplier) + 128 + brightnessBoost;
        data[i + 2] = ((data[i + 2] - 128) * contrastMultiplier) + 128 + brightnessBoost;
        
        // Clamp to valid range
        data[i] = Math.max(0, Math.min(255, data[i]));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1]));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2]));
      }
      
      // Step 4: Apply sharpening filter for blurry images
      const sharpenedData = sharpenImage(imageData);
      
      // Put enhanced image back
      ctx.putImageData(sharpenedData, 0, 0);
      
      // Maximum quality
      return canvas.toDataURL('image/jpeg', 1.0).split(',')[1];
    } catch (err) {
      console.error('Frame capture error:', err);
      return null;
    }
  };

  const sharpenImage = (imageData: ImageData): ImageData => {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const output = new ImageData(width, height);
    
    // Sharpening kernel
    const kernel = [
      0, -1, 0,
      -1, 5, -1,
      0, -1, 0
    ];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) { // RGB channels only
          let sum = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const idx = ((y + ky) * width + (x + kx)) * 4 + c;
              const kernelIdx = (ky + 1) * 3 + (kx + 1);
              sum += data[idx] * kernel[kernelIdx];
            }
          }
          const outIdx = (y * width + x) * 4 + c;
          output.data[outIdx] = Math.max(0, Math.min(255, sum));
        }
        // Copy alpha channel
        output.data[(y * width + x) * 4 + 3] = 255;
      }
    }
    
    return output;
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
                  text: 'Extract ALL readable text from this image, even if blurry, low quality, or partially visible. Look for: product names, brands, descriptions, labels, prices, ingredients, or ANY text near/around barcodes. Try your best to read imperfect, tilted, or low-resolution text. Return ONLY the extracted text. If truly nothing is readable, return empty string.'
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
