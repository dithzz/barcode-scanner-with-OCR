import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';
import Quagga from '@ericblade/quagga2';

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
type ScanMode = 'barcode-ocr' | 'ocr-only' | 'photo-upload';

export function BarcodeScanner({ onScan, videoRef }: BarcodeScannerProps) {
  const [error, setError] = useState('');
  const [debugInfo, setDebugInfo] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>('environment'); // Default to back camera
  const [scanMode, setScanMode] = useState<ScanMode>('barcode-ocr'); // Default to barcode + OCR
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const quaggaRunningRef = useRef<boolean>(false);
  const lastBarcodeRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);
  const ocrIntervalRef = useRef<number | null>(null);
  const candidateBarcodesRef = useRef<Map<string, { format: string, source: string, count: number, firstSeen: number }>>(new Map());
  const barcodeSelectionTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Detect if device is mobile
    const checkMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const isMobileDevice = /iphone|ipad|ipod|android|blackberry|windows phone/g.test(userAgent);
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      setIsMobile(isMobileDevice || (isTouchDevice && window.innerWidth < 1024));
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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

      // Stop Quagga if running
      if (quaggaRunningRef.current) {
        try {
          Quagga.stop();
          quaggaRunningRef.current = false;
        } catch (e) {
          console.log('Quagga already stopped');
        }
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
      
      // Configure for maximum accuracy - more aggressive for difficult barcodes like USPS
      const hints = new Map();
      hints.set(DecodeHintType.TRY_HARDER, true); // More thorough scanning - critical for USPS barcodes
      // Removed PURE_BARCODE - may interfere with detection of barcodes with text nearby
      hints.set(DecodeHintType.ASSUME_GS1, false); // Don't assume GS1 format
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
            await handleBarcodeDetected(barcodeValue, barcodeFormat, 'ZXing');
          }
        }
      );

      // Start Quagga2 for 1D barcode scanning (parallel to ZXing)
      startQuagga();

      setDebugInfo('👁️ Scanning... (USPS tracking? Use OCR mode 📝)');
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
          height: { ideal: 1080 },
          // @ts-ignore - advanced constraints for better barcode scanning
          focusMode: 'continuous',
          // @ts-ignore
          zoom: { ideal: 1.0 }
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
              height: { ideal: 1080 },
              // @ts-ignore - advanced constraints for better barcode scanning
              focusMode: 'continuous',
              // @ts-ignore
              zoom: { ideal: 1.0 }
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

  // Unified barcode handler for both ZXing and Quagga - with smart prioritization
  const handleBarcodeDetected = async (barcodeValue: string, barcodeFormat: string, source: string) => {
    const now = Date.now();
    
    // Skip if this is the same barcode we just processed
    if (barcodeValue === lastBarcodeRef.current && now - lastScanTimeRef.current < 3000) {
      return;
    }
    
    // Add to candidates or update count
    const existing = candidateBarcodesRef.current.get(barcodeValue);
    if (existing) {
      existing.count++;
    } else {
      candidateBarcodesRef.current.set(barcodeValue, {
        format: barcodeFormat,
        source: source,
        count: 1,
        firstSeen: now
      });
    }
    
    console.log(`${source}: Detected ${barcodeFormat} (len: ${barcodeValue.length}): ${barcodeValue}`);
    
    // Clear any existing selection timer
    if (barcodeSelectionTimerRef.current) {
      clearTimeout(barcodeSelectionTimerRef.current);
    }
    
    // Wait 1500ms to collect multiple barcode detections, then pick the best one
    barcodeSelectionTimerRef.current = window.setTimeout(() => {
      selectBestBarcode();
    }, 1500);
  };
  
  const selectBestBarcode = async () => {
    if (candidateBarcodesRef.current.size === 0 || isProcessing) return;
    
    console.log(`\n=== SELECTING BEST BARCODE (${candidateBarcodesRef.current.size} candidates) ===`);
    
    // PRIORITY SYSTEM for consistent results:
    // 1. ALWAYS prefer Code 128 over product barcodes (EAN, UPC)
    // 2. Among Code 128s, pick the longest one (tracking numbers are long)
    // 3. Ignore short product barcodes when Code 128 is available
    
    let bestBarcode = '';
    let bestData: any = null;
    let hasCode128 = false;
    
    // First pass: check if we have any Code 128 barcodes
    for (const [code, data] of candidateBarcodesRef.current.entries()) {
      console.log(`  Candidate: ${data.format} (len: ${code.length}, count: ${data.count}) - ${code}`);
      if (data.format === 'code_128') {
        hasCode128 = true;
      }
    }
    
    console.log(`  Has Code 128: ${hasCode128}`);
    
    // Second pass: select best barcode with priority rules
    for (const [code, data] of candidateBarcodesRef.current.entries()) {
      // If we have Code 128, IGNORE all non-Code 128 barcodes
      if (hasCode128 && data.format !== 'code_128') {
        console.log(`  ⊗ Skipping ${data.format} (${code}) - Code 128 takes priority`);
        continue;
      }
      
      // Select if: first barcode OR longer than current best OR same length but more detections
      if (!bestBarcode || 
          code.length > bestBarcode.length ||
          (code.length === bestBarcode.length && data.count > bestData.count)) {
        bestBarcode = code;
        bestData = data;
      }
    }
    
    if (!bestBarcode) {
      console.log(`  ⚠️ NO VALID BARCODE FOUND - Try OCR mode for USPS tracking numbers\n`);
      return;
    }
    
    console.log(`  ✓✓✓ FINAL SELECTION: ${bestData.format} (len: ${bestBarcode.length}, count: ${bestData.count})`);
    console.log(`  Value: ${bestBarcode}`);
    
    // SPECIAL: For USPS labels, also extract tracking number via OCR
    // The printed tracking number is more reliable than the barcode
    if (bestBarcode.length >= 20 && bestData.format === 'code_128') {
      console.log(`  ℹ️ Long Code 128 detected - this might be encoded USPS data`);
      console.log(`  💡 TIP: Switch to OCR mode (📝) to get the actual tracking number\n`);
    } else {
      console.log();
    }
    
    // Clear candidates
    candidateBarcodesRef.current.clear();
    
    // Update references
    lastBarcodeRef.current = bestBarcode;
    lastScanTimeRef.current = Date.now();
    setIsProcessing(true);
    
    // Show status
    setDebugInfo(`⚡ ${bestBarcode}`);
    
    // Take screenshot
    const screenshot = captureFrame();
    
    if (!screenshot) {
      onScan({
        barcode: {
          value: bestBarcode,
          format: bestData.format
        },
        text: ''
      });
      setIsProcessing(false);
      setDebugInfo('👁️ Ready');
      return;
    }
    
    // Call AI for text extraction (async)
    extractTextWithAI(screenshot).then(extractedText => {
      onScan({
        barcode: {
          value: bestBarcode,
          format: bestData.format
        },
        text: extractedText || '(No text found)'
      });
      setIsProcessing(false);
      setDebugInfo('👁️ Ready');
    }).catch(err => {
      console.error('AI extraction failed:', err);
      onScan({
        barcode: {
          value: bestBarcode,
          format: bestData.format
        },
        text: '(AI extraction failed)'
      });
      setIsProcessing(false);
      setDebugInfo('👁️ Ready');
    });
  };

  const startQuagga = () => {
    if (!videoRef.current || quaggaRunningRef.current) return;

    try {
      Quagga.init({
        inputStream: {
          name: "Live",
          type: "LiveStream",
          target: videoRef.current,
          constraints: {
            facingMode: facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          area: { // Focus on center area where user likely points barcode
            top: "20%",
            right: "10%",
            left: "10%",
            bottom: "20%"
          }
        },
        decoder: {
          readers: [
            "code_128_reader",    // USPS tracking, shipping labels - PRIMARY
            "code_39_reader",     // General purpose
            "ean_reader",         // Products
            "upc_reader",         // Products
            "codabar_reader"      // Other formats
          ],
          multiple: false,
          // Add quality settings for better accuracy
          debug: {
            drawBoundingBox: false,
            showFrequency: false,
            drawScanline: false,
            showPattern: false
          }
        },
        locate: true,
        locator: {
          patchSize: "x-large",    // Largest patch size for difficult barcodes
          halfSample: false        // Full resolution
        },
        frequency: 20,             // Increased from 10 to 20 scans per second
        numOfWorkers: 0,           // Use main thread for better performance
        debug: false
      }, (err) => {
        if (err) {
          console.error('Quagga initialization error:', err);
          return;
        }
        
        Quagga.start();
        quaggaRunningRef.current = true;
        
        Quagga.onDetected(async (result) => {
          if (result && result.codeResult && result.codeResult.code) {
            const code = result.codeResult.code;
            const format = result.codeResult.format || 'unknown';
            
            // Very lenient quality check - accept almost everything
            const quality = result.codeResult.decodedCodes
              .filter((code: any) => code.error !== undefined)
              .reduce((sum: number, code: any) => sum + code.error, 0) / result.codeResult.decodedCodes.length;
            
            // Only reject extremely poor reads
            if (quality > 0.35) {
              console.log(`Quagga: Poor quality rejected (error: ${quality.toFixed(3)})`);
              return;
            }
            
            console.log(`Quagga: ✓ Detected ${format} (error: ${quality.toFixed(3)}, len: ${code.length}): ${code}`);
            await handleBarcodeDetected(code, format, 'Quagga');
          }
        });
      });
    } catch (err) {
      console.error('Quagga start error:', err);
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
    setScanMode(prev => {
      // On desktop, skip photo-upload mode (file picker only)
      if (!isMobile) {
        return prev === 'barcode-ocr' ? 'ocr-only' : 'barcode-ocr';
      }
      // On mobile, cycle through all 3 modes
      const modes: ScanMode[] = ['barcode-ocr', 'ocr-only', 'photo-upload'];
      const currentIndex = modes.indexOf(prev);
      const nextIndex = (currentIndex + 1) % modes.length;
      return modes[nextIndex];
    });
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setDebugInfo('📸 Processing photo...');

    try {
      // Convert image to base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Image = e.target?.result as string;
        const base64Data = base64Image.split(',')[1];

        // Try barcode detection first
        try {
          const codeReader = new BrowserMultiFormatReader();
          const hints = new Map();
          hints.set(DecodeHintType.TRY_HARDER, true);
          codeReader.hints = hints;

          const result = await codeReader.decodeFromImageUrl(base64Image);
          
          if (result) {
            const barcodeValue = result.getText();
            const barcodeFormat = result.getBarcodeFormat().toString();
            
            setDebugInfo('✓ Barcode detected!');
            
            // Also extract text via OCR
            const extractedText = await extractTextWithAI(base64Data);
            
            onScan({
              barcode: {
                value: barcodeValue,
                format: barcodeFormat
              },
              text: extractedText || ''
            });
            
            setIsProcessing(false);
            setDebugInfo('📸 Photo Mode - Tap to capture');
            return;
          }
        } catch (barcodeErr) {
          console.log('No barcode found in image, trying OCR...');
        }

        // Fallback to OCR if no barcode found
        const extractedText = await extractTextWithAI(base64Data);
        
        if (extractedText && extractedText.trim()) {
          onScan({
            text: extractedText
          });
          setDebugInfo('✓ Text extracted!');
        } else {
          setDebugInfo('⚠️ No barcode or text found');
        }
        
        setIsProcessing(false);
        setTimeout(() => {
          setDebugInfo('📸 Photo Mode - Tap to capture');
        }, 2000);
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Photo processing error:', err);
      setDebugInfo('❌ Processing failed');
      setIsProcessing(false);
    }

    // Reset input so same file can be selected again
    event.target.value = '';
  };

  const triggerPhotoCapture = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="scanner-container">
      {/* Hidden file input for native camera/photo picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handlePhotoUpload}
      />
      
      <video 
        ref={videoRef} 
        className="scanner-video"
        style={{ display: scanMode === 'photo-upload' ? 'none' : 'block' }}
        playsInline
        autoPlay
        muted
      />
      {scanMode === 'photo-upload' && (
        <div className="photo-upload-placeholder" onClick={triggerPhotoCapture}>
          <div className="upload-icon">📸</div>
          <p>Tap to {isMobile ? 'capture photo' : 'select image'}</p>
          <p className="upload-hint">{isMobile ? 'Uses native camera' : 'Upload from files'}</p>
        </div>
      )}
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
        title={
          scanMode === 'barcode-ocr' ? 'Switch to OCR Only' : 
          scanMode === 'ocr-only' ? 'Switch to Photo Mode' : 
          'Switch to Barcode + OCR'
        }
      >
        {scanMode === 'barcode-ocr' ? '📊' : scanMode === 'ocr-only' ? '📝' : '📷'}
      </button>
      {availableCameras.length > 1 && scanMode !== 'photo-upload' && (
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
      {scanMode === 'photo-upload' && (
        <button 
          className="ocr-scan-btn" 
          onClick={triggerPhotoCapture}
          disabled={isProcessing}
          aria-label="Capture photo"
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
        {scanMode === 'barcode-ocr' ? '📊 Barcode + OCR' : 
         scanMode === 'ocr-only' ? '📝 OCR Only' : 
         '📷 Photo Mode'}
      </div>
    </div>
  );
}
