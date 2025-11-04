import { useRef, useState } from 'react';
import Tesseract from 'tesseract.js';

interface OCRScannerProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  onOCRResult: (text: string) => void;
}

export const OCRScanner = ({ videoRef, onOCRResult }: OCRScannerProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));

  const captureAndRecognize = async () => {
    if (!videoRef.current || isProcessing) return;
    
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    setIsProcessing(true);
    setOcrProgress(0);

    try {
      // Capture frame from video
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert to blob
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png');
      });

      // Perform OCR
      const result = await Tesseract.recognize(
        blob,
        'eng',
        {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              setOcrProgress(Math.round(m.progress * 100));
            }
          }
        }
      );

      const text = result.data.text.trim();
      if (text) {
        console.log('📝 OCR Result:', text);
        onOCRResult(text);
      }
    } catch (error) {
      console.error('OCR Error:', error);
    } finally {
      setIsProcessing(false);
      setOcrProgress(0);
    }
  };

  return (
    <div className="ocr-controls">
      <button 
        onClick={captureAndRecognize}
        disabled={isProcessing}
        className="ocr-button"
      >
        {isProcessing ? `Processing... ${ocrProgress}%` : '📝 Scan Text (OCR)'}
      </button>
    </div>
  );
};
