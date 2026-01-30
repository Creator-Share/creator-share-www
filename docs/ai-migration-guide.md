# AI Proofreading Migration Guide

## Overview

This guide covers the migration from Google Gemini-specific to a generic OpenAI-compatible API implementation for AI proofreading of beneficiary biographies and activity descriptions.

## What Changed

### Before (Gemini-specific)
- **Package**: `@google/generative-ai`
- **Environment Variable**: `GEMINI_API_KEY`
- **Provider**: Google Gemini only
- **Model**: `gemini-2.5-pro` (hardcoded)

### After (OpenAI-compatible generic)
- **Package**: `openai-edge` v1.2.2
- **Environment Variables**: 
  - `LLM_API_KEY` - API key for your chosen provider (required)
  - `LLM_API_HOST` - Base URL for the API endpoint (required)
  - `LLM_MODEL` - Model identifier (optional, defaults to `gpt-4o-mini`)
- **Provider**: OpenAI, OpenRouter, Azure OpenAI, Ollama, LM Studio, or any OpenAI-compatible API
- **Implementation**: Generic OpenAI SDK with configurable endpoints

---

## For Developers

### Step 1: Update Environment Variables

Edit your `.env` or `.env.local` file:

**Remove:**
```bash
GEMINI_API_KEY=your_old_gemini_key
```

**Add:**
```bash
# Required: Your LLM API key
LLM_API_KEY=your_api_key_here

# Required: API base path (WITHOUT trailing slash, see examples below)
LLM_API_HOST=https://api.openai.com/v1

# Optional: Model identifier (defaults to gpt-4o-mini)
LLM_MODEL=gpt-4o-mini
```

**IMPORTANT**: The `LLM_API_HOST` should **NOT** have a trailing slash and should include `/v1` as shown in the examples below.

### Step 2: Choose Your Provider

#### Option A: OpenAI

1. Get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Configure `.env`:
   ```bash
   LLM_API_KEY=sk-...
   LLM_API_HOST=https://api.openai.com/v1
   LLM_MODEL=gpt-4o-mini
   ```

**Available models**: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`

#### Option B: OpenRouter (Recommended for Gemini)

OpenRouter provides access to multiple LLM providers including Gemini through one API.

1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Configure `.env`:
   ```bash
   LLM_API_KEY=sk-or-v1-...
   LLM_API_HOST=https://openrouter.ai/api/v1
   LLM_MODEL=google/gemini-2.0-flash-exp
   ```

**Available models**: `google/gemini-2.0-flash-exp`, `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, and many more

#### Option C: Azure OpenAI

1. Get deployment details from Azure Portal
2. Configure `.env`:
   ```bash
   LLM_API_KEY=your_azure_key
   LLM_API_HOST=https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT
   LLM_MODEL=gpt-4
   ```

#### Option D: Ollama (Local, Free)

1. Install [Ollama](https://ollama.ai/)
2. Pull a model: `ollama pull llama2`
3. Start Ollama server
4. Configure `.env`:
   ```bash
   LLM_API_KEY=ollama
   LLM_API_HOST=http://localhost:11434/v1
   LLM_MODEL=llama2
   ```

#### Option E: LM Studio (Local, Free)

1. Install [LM Studio](https://lmstudio.ai/)
2. Load a model and start the local server (enable OpenAI compatibility)
3. Configure `.env`:
   ```bash
   LLM_API_KEY=lm-studio
   LLM_API_HOST=http://localhost:1234/v1
   LLM_MODEL=local-model
   ```

### Step 3: Install Dependencies

```bash
yarn install
```

This removes `@google/generative-ai` and installs `openai-edge`.

### Step 4: Restart Development Server

```bash
# Stop the current server (Ctrl+C)
npm run dev
```

### Step 5: Verify It Works

1. Navigate to **Admin → Children** (or Activities)
2. Click **"Add a Child"** or edit an existing child
3. Enter text in the **Biography** field
4. Click the **"AI Proofread"** button (sparkles icon)
5. Review the inline comparison showing original vs improved text
6. Click **Accept**, **Reject**, or **Retry** with optional instructions

**Expected behavior:**
- AI Proofread button appears below biography/activity text fields
- Button is **hidden** if LLM environment variables are not configured
- Clicking generates improved text (loads for 1-3 seconds)
- Inline comparison appears with original and improved text side-by-side
- User can accept, reject, or retry with additional instructions

---

## For Production Deployment

### Environment Variables

Set these environment variables in your production environment:

**Required:**
```bash
LLM_API_KEY=your_production_api_key
LLM_API_HOST=https://api.openai.com/v1
```

**Optional:**
```bash
LLM_MODEL=gpt-4o-mini  # Defaults to gpt-4o-mini if omitted
```

### Platform-Specific Instructions

**Vercel:**
1. Go to Project Settings → Environment Variables
2. Add `LLM_API_KEY`, `LLM_API_HOST`, and optionally `LLM_MODEL`
3. Redeploy

**Netlify:**
1. Go to Site Settings → Environment Variables
2. Add variables
3. Trigger a new deploy

**Railway/Render:**
1. Go to your service settings
2. Add environment variables
3. Redeploy

### Feature Behavior

**With both LLM_API_KEY and LLM_API_HOST set:**
- AI Proofread buttons appear in admin panels
- Feature works normally

**Without LLM_API_KEY or LLM_API_HOST:**
- AI Proofread buttons are **hidden** (not shown at all)
- Manual text entry works normally
- **No breaking changes** - graceful degradation

---

## Troubleshooting

### Button Not Appearing

**Causes:**
1. `LLM_API_KEY` or `LLM_API_HOST` not set
2. Server not restarted after changing `.env`
3. API config endpoint returning `available: false`

**Solutions:**
```bash
# Check if feature is available
curl http://localhost:3000/api/ai/config
# Should return: {"available":true}

# Restart dev server
npm run dev
```

### API Errors

**Error: "API authentication failed"**
- Verify `LLM_API_KEY` is correct and active
- Check key has necessary permissions

**Error: "API endpoint not found" or 404**
- Check `LLM_API_HOST` format
- Ensure NO trailing slash: `https://openrouter.ai/api/v1` ✓
- NOT: `https://openrouter.ai/api/v1/` ✗
- Include `/v1` in the path for most providers

**Error: "API returned HTML instead of JSON"**
- `LLM_API_HOST` is pointing to wrong endpoint
- Remove trailing slash from `LLM_API_HOST`
- Verify the endpoint URL with your provider's documentation

**Error: "Rate limit exceeded"**
- Wait a moment before retrying
- Check your provider's rate limits
- Consider upgrading your plan or using a different provider

### Configuration Issues

1. **Environment variables not loading:**
   - Check `.env` file is in project root
   - Restart server completely
   - No typos in variable names (case-sensitive)

2. **Slow responses:**
   - Switch to faster model (gpt-4o-mini, gpt-3.5-turbo)
   - Check network connection
   - Local models: ensure adequate hardware

3. **Cost concerns:**
   - Use `gpt-4o-mini` (cheapest OpenAI option)
   - Use OpenRouter for pay-per-use flexibility
   - Use local Ollama/LM Studio (completely free)

---

## Testing Checklist

After migration, verify:

- [ ] `yarn install` completed successfully
- [ ] Environment variables set correctly (no trailing slashes)
- [ ] Dev server starts without errors
- [ ] Navigate to Admin → Children → Add/Edit
- [ ] AI Proofread button appears below biography field
- [ ] Click button, see inline comparison appear
- [ ] Original text shows on left, improved on right
- [ ] Can accept suggestions (text updates in form)
- [ ] Can reject suggestions (returns to normal view)
- [ ] Can retry with additional instructions
- [ ] Test with Activities (title and description fields)
- [ ] Verify proper content transformation (removes stigmatized content, person-first language, etc.)

---

## Content Transformation

The AI proofreading uses CreatorShare-specific prompts that:

✅ **Remove sensitive content:**
- HIV/AIDS mentions and euphemisms ("the virus")
- Sexually transmitted infections (STIs)
- Graphic trauma or abuse details

✅ **Improve language:**
- Person-first language for disabilities
- Focus on current family (not deceased)
- Dignified framing (no pity language)
- Child-centric and hopeful tone

✅ **Preserve content:**
- Religious language exactly as written
- Child's name, age, and factual details
- Personality traits and interests

✅ **Remove:**
- Specific cost amounts
- Poverty pornography language
- Sensationalized descriptions

See `docs/ai-proofreading.md` for full details on content transformation guidelines.

---

## Rollback Plan

If you need to revert to Gemini:

```bash
# 1. Revert code changes
git checkout <previous-commit> src/utils/ai/
git checkout <previous-commit> src/components/ai/
git checkout <previous-commit> src/app/api/ai/

# 2. Restore dependencies
yarn add @google/generative-ai
yarn remove openai-edge

# 3. Restore environment variable
# In .env file:
GEMINI_API_KEY=your_gemini_key
# Remove: LLM_API_KEY, LLM_API_HOST, LLM_MODEL

# 4. Restart server
npm run dev
```

---

## Support & Resources

**Documentation:**
- [AI Proofreading Feature Guide](./ai-proofreading.md) - Full feature documentation
- [OpenAI Platform](https://platform.openai.com/)
- [OpenRouter](https://openrouter.ai/)
- [Ollama](https://ollama.ai/)
- [LM Studio](https://lmstudio.ai/)

**Common Issues:**
- Check server console for detailed error logs (prefixed with "LLM API error:")
- Test API endpoint manually: `curl http://localhost:3000/api/ai/config`
- Verify environment variables: `echo $LLM_API_HOST` (in terminal where server runs)

**For Help:**
1. Review this guide's troubleshooting section
2. Check `docs/ai-proofreading.md` for feature details
3. Review provider-specific documentation
4. Check server console logs for errors
