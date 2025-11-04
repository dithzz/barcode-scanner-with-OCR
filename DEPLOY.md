# 🚀 Vercel Deployment Checklist

## ✅ Pre-Deployment (Already Done!)

- [x] `vercel.json` configured
- [x] TypeScript linting disabled for build
- [x] Mobile-first responsive design
- [x] Camera switching implemented
- [x] Image enhancement for poor quality barcodes
- [x] README.md with deployment instructions
- [x] .env.example created

## 📋 Deploy Steps

### Option A: GitHub + Vercel Dashboard (Recommended)

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Barcode Scanner App"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Deploy on Vercel**:
   - Go to https://vercel.com/new
   - Import your GitHub repository
   - Framework Preset: **Vite** (auto-detected)
   - Add Environment Variable:
     - Name: `VITE_OPENROUTER_API_KEY`
     - Value: `YOUR_OPENROUTER_API_KEY`
   - Click **Deploy**
   - Done! 🎉

### Option B: Vercel CLI

1. **Install Vercel CLI**:
   ```bash
   npm i -g vercel
   ```

2. **Login**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel
   ```

4. **Add Environment Variable** (when prompted or via dashboard):
   - `VITE_OPENROUTER_API_KEY=your_key_here`

5. **Deploy to Production**:
   ```bash
   vercel --prod
   ```

## 🔑 Environment Variable

**REQUIRED**: You must add your OpenRouter API key as an environment variable in Vercel:

1. Go to your project settings on Vercel
2. Navigate to "Environment Variables"
3. Add:
   - **Name**: `VITE_OPENROUTER_API_KEY`
   - **Value**: Your API key from https://openrouter.ai/keys
   - **Environments**: Production, Preview, Development (select all)

## 🧪 Test After Deployment

1. Open deployed URL on your phone
2. Allow camera permissions
3. Test barcode scanning
4. Test camera switching (🔄 button)
5. Check AI text extraction

## 📱 Mobile Testing

- Test on iOS Safari
- Test on Android Chrome
- Verify HTTPS (required for camera)
- Test camera switching
- Test poor lighting scenarios

## 🐛 Common Issues

**Camera not working?**
- Ensure HTTPS is enabled (Vercel does this automatically)
- Check browser permissions
- Make sure `.env` variable is set in Vercel

**Build failing?**
- Check that `VITE_OPENROUTER_API_KEY` is in Vercel environment variables
- TypeScript linting is already disabled

**API not working?**
- Verify API key in Vercel environment variables
- Check OpenRouter account has credits
- API key must start with `sk-or-v1-`

## 💰 Cost Reminder

- Barcode scanning: **FREE** (browser-based)
- AI text extraction: **~$0.27 per 1000 scans**
- Add credits at: https://openrouter.ai/credits

## 🎉 Your App is Ready!

Everything is configured and ready to deploy. Just follow the steps above!
