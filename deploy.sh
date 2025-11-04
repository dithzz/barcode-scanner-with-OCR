#!/bin/bash

# Quick Deploy to Vercel Script
# Run this after setting up your GitHub repo

echo "🚀 Deploying Barcode Scanner to Vercel..."
echo ""

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "📦 Installing Vercel CLI..."
    npm i -g vercel
fi

echo "🔐 Logging into Vercel..."
vercel login

echo "🏗️  Deploying to Vercel..."
vercel --prod

echo ""
echo "✅ Deployment complete!"
echo ""
echo "⚠️  IMPORTANT: Don't forget to add your environment variable in Vercel dashboard:"
echo "   Variable: VITE_OPENROUTER_API_KEY"
echo "   Value: Your OpenRouter API key"
echo ""
echo "📱 Your app is ready at the URL shown above!"
