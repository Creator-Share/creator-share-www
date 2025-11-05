# AI Proofreading Feature

This document explains how to set up and use the AI proofreading feature powered by Google Gemini Flash.

## Overview

The AI proofreading feature helps improve the quality of:
- **Beneficiary biographies** - When creating or editing children profiles
- **Activity titles** - When creating or editing activities
- **Activity descriptions** - When creating or editing activities

The AI improves:
- ✅ Grammar and spelling
- ✅ Readability and sentence flow
- ✅ Empathetic and professional tone
- ✅ Overall engagement while preserving meaning

## Setup Instructions

### 1. Get a Free Google Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Get API Key" or "Create API Key"
4. Copy your API key

**Important Notes:**
- ✅ **No credit card required** for the free tier
- ✅ Free tier limits: 15 requests/minute, 1,500 requests/day
- ✅ Perfect for small-to-medium usage

### 2. Add API Key to Environment Variables

1. Open your `.env` file (or create one from `dotenv.sample`)
2. Add the following line:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
3. Replace `your_api_key_here` with your actual API key

### 3. Restart Your Development Server

After adding the API key, restart your Next.js development server:

```bash
# Stop the current server (Ctrl+C)
# Then restart
yarn dev
```

## How to Use

### Proofreading a Biography

1. Go to **Admin Panel** → **Children**
2. Click **"Add a Child"** or click **Edit** on an existing child
3. Fill in the biography field
4. Click the **"AI Proofread"** button below the biography textarea
5. Review the AI suggestions in the modal
6. Click **"Accept AI Suggestions"** to apply, or **"Keep Original"** to discard

### Proofreading Activity Content

1. Go to **Admin Panel** → **Activities**
2. Click **"Create Activity"** or edit an existing activity
3. Fill in the title and/or description
4. Click the **"AI Proofread"** button below each field
5. Review and accept or reject suggestions

## Features

### Smart Proofreading
The AI:
- Fixes grammar, spelling, and punctuation errors
- Improves sentence structure and flow
- Maintains empathetic tone appropriate for charitable content
- Preserves all original meaning and key information
- Makes text more engaging while staying respectful

### User Control
- See side-by-side comparison (original vs. improved)
- Accept or reject suggestions with one click
- No automatic changes - you're always in control

### Performance
- Fast response times (usually 1-3 seconds)
- Works offline-first - only sends text when you click "Proofread"
- Handles text up to 10,000 characters

## Rate Limits

Google Gemini Free Tier:
- **15 requests per minute**
- **1,500 requests per day**

If you exceed the limit, you'll see a friendly error message asking you to wait a moment before trying again.

## Troubleshooting

### "API key is not configured" Error
- Make sure `GEMINI_API_KEY` is set in your `.env` file
- Restart your development server after adding the key
- Check for typos in the environment variable name

### "Rate limit exceeded" Error
- Wait 1 minute before trying again
- The free tier allows 15 requests per minute
- Consider upgrading to paid tier if you need higher limits

### Proofreading Button Not Appearing
- Make sure you've restarted the development server
- Check browser console for any errors
- Clear browser cache and reload

### Poor Quality Suggestions
- Provide more context in the original text
- The AI works best with complete sentences
- Very short text (1-2 words) may not benefit from proofreading

## Technical Details

### Architecture
- **Frontend**: React components (`ProofreadButton`, `ProofreadModal`)
- **API**: Next.js API route (`/api/ai/proofread`)
- **AI Service**: Google Gemini 1.5 Flash model
- **Integration Points**:
  - `BeneficiaryModal.tsx` - Biography field
  - `ActivityModals.tsx` - Title and description fields

### Security
- API key is stored server-side only (never exposed to browser)
- All requests are validated and rate-limited
- Text is sent securely over HTTPS
- No text is stored by Google after processing

### Cost
- **Free tier**: $0/month (with usage limits)
- **Paid tier**: If you need more, pricing starts very low
  - Input: ~$0.075 per 1M characters
  - Output: ~$0.30 per 1M characters

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Verify your API key is valid at [Google AI Studio](https://aistudio.google.com/app/apikey)
3. Check server logs for detailed error messages
4. Ensure you're within rate limits

## Future Enhancements

Potential improvements:
- Multiple suggestion options to choose from
- Custom tone settings (formal, casual, empathetic)
- Batch proofreading for multiple items
- Translation support for multilingual content
