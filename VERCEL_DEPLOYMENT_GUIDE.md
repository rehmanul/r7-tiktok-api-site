# Vercel Deployment Guide

## Automatic Deployment (Recommended)

Vercel has **built-in GitHub integration** that automatically deploys your project when you push changes. No GitHub Actions workflow needed!

### Setup Steps:

1. **Go to Vercel Dashboard**: https://vercel.com/
2. **Import Your Repository**:
   - Click "Add New Project"
   - Import your GitHub repository: `Jkratz01/tiktok-api-site`
   - Vercel will auto-detect it's a Node.js project
3. **Configure Settings** (recommended):
   - Framework Preset: Other
   - Build Command: `npm run build` (runs a lightweight sanity check)
   - Install Command: `npm ci`
   - Output Directory: leave empty (serverless functions only)
   - Node.js Version: `22.x` (required by Vercel as of 2025; ensure Project Settings → General → Node.js Version is set accordingly)
   - Memory: leave at the Hobby default (2048 MB). Higher values require a Vercel Pro/Team plan.
4. **Deploy**: Click "Deploy"

### What Happens Automatically:

✅ Every push to `main` branch → Automatic production deployment  
✅ Every PR → Automatic preview deployment  
✅ Build logs and deployment status in Vercel dashboard  
✅ Custom domain support (if needed)  

## Manual Deployment (Alternative)

If you prefer manual control, use the Vercel CLI:

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to production
vercel --prod
```

## Environment Variables

If you need environment variables (like TikTok cookies), add them in:
- **Vercel Dashboard** → Your Project → Settings → Environment Variables

Example variables you might need:
- `TIKTOK_SESSION_ID`
- `TIKTOK_WEBID`
- `TIKTOK_MSTOKEN`

## No GitHub Actions Required

The custom GitHub Actions deployment workflow has been removed because:
- ❌ Requires manual secret configuration
- ❌ Duplicates Vercel's built-in functionality
- ✅ Vercel's integration is more reliable and easier

## Deployment Status

After connecting to Vercel:
- Check deployment status: https://vercel.com/dashboard
- View production URL: Vercel will provide your API endpoint
- Test your API: `https://your-project.vercel.app/api/tiktok?username=test`

## Troubleshooting

If Vercel deployment fails:
1. Check build logs in Vercel dashboard
2. Ensure `package.json` has correct Node version: `"node": ">=18.0.0"`
3. Verify `vercel.json` configuration is correct
4. Make sure all dependencies are in `package.json`

The project is now ready - just connect it to Vercel and it will deploy automatically!

