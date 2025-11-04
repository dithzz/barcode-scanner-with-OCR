# Barcode Scanner App 📱

A fast, mobile-first barcode scanner with AI-powered text extraction. Built with React, ZXing, and OpenRouter AI.

## 🚀 Features

- **Instant Barcode Detection**: Scans all major formats (EAN, UPC, QR, Code128, etc.) in under 1 second
- **AI Text Extraction**: Extracts product information using GPT-4o-mini vision
- **Mobile-First Design**: Optimized for smartphones with camera switching
- **Front/Back Camera Support**: Switch between cameras with a single tap
- **Hybrid Approach**: Free ZXing for barcodes + AI only for text (cost-effective)
- **Poor Quality Support**: Enhanced image processing for low light/damaged barcodes

## 📦 Tech Stack

- React 19 + TypeScript
- Vite 7
- @zxing/browser (barcode detection)
- OpenRouter API (GPT-4o-mini)
- CSS3 with mobile-first responsive design

## 🛠️ Local Development

1. **Clone and install**:
```bash
npm install
```

2. **Set up environment variables**:
```bash
cp .env.example .env
# Edit .env and add your OpenRouter API key
```

3. **Run development server**:
```bash
npm run dev
```

4. **Build for production**:
```bash
npm run build
```

## 🌐 Deploy to Vercel

### Method 1: Vercel Dashboard (Easiest)

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project"
4. Import your GitHub repository
5. Add environment variable:
   - Key: `VITE_OPENROUTER_API_KEY`
   - Value: Your OpenRouter API key
6. Click "Deploy"

### Method 2: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel
```

When prompted, add your `VITE_OPENROUTER_API_KEY` as an environment variable.

## 🔑 Getting an OpenRouter API Key

1. Visit [openrouter.ai](https://openrouter.ai)
2. Sign up for an account
3. Go to [Keys](https://openrouter.ai/keys)
4. Create a new API key
5. Add credits to your account (GPT-4o-mini costs ~$0.27 per 1000 scans)

## 💰 Cost

- **Barcode Detection**: FREE (runs in browser via ZXing)
- **AI Text Extraction**: ~$0.00027 per scan (GPT-4o-mini)
- **Estimated monthly cost**: <$1 for typical personal use

## 📱 Mobile Usage

1. Open the deployed URL on your smartphone
2. Allow camera permissions
3. Point camera at barcode
4. Tap 🔄 to switch between front/back cameras
5. View instant results!

## 🔒 HTTPS Required

Camera access requires HTTPS. Vercel provides this automatically. For local testing:
- Use `localhost` (automatically trusted by browsers)
- Or set up a local HTTPS proxy

## 📄 License

MIT
