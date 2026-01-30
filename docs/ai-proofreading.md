# AI Proofreading Feature (OpenAI-Compatible)

This document explains how to set up and use the AI proofreading feature powered by OpenAI-compatible LLM APIs.

## Overview

The AI proofreading feature helps transform beneficiary stories with dignity and respect, aligned with CreatorShare's mission: **"Making invisible children visible."**

The AI transforms:
- **Beneficiary biographies** - When creating or editing children profiles
- **Activity titles** - When creating or editing activities
- **Activity descriptions** - When creating or editing activities

**Dignity-First Approach**: Our AI prompts are specifically designed to honor the children we serve by:
- ✅ Protecting privacy and sensitive information
- ✅ Using person-first, respectful language
- ✅ Focusing on hope, resilience, and potential
- ✅ Eliminating pity-based narratives
- ✅ Maintaining authenticity while improving clarity

This feature works with any OpenAI-compatible API provider, giving you flexibility in choosing your LLM provider based on cost, performance, and privacy needs.

## What Gets Transformed

Our AI proofreading goes beyond simple grammar fixes. It applies CreatorShare-specific transformations to ensure every child's story is told with dignity:

### Privacy Protection
- **Removes sensitive medical information**: HIV/AIDS status, STIs, graphic medical details
- **Protects vulnerable details**: Specific trauma descriptions, abuse details
- **Maintains context without harm**: Transforms "HIV-positive" to general health challenges

### Person-First Language
- **Before**: "disabled child", "orphan", "AIDS victim"
- **After**: "child with a disability", "child without parents", "child affected by illness"

### Focus on the Present
- **Shifts from**: Deceased family members, tragic past events
- **Shifts to**: Current caregivers, support systems, daily life, dreams

### Dignity-First Framing
- **Eliminates**: "Suffering", "desperate", "helpless", "pitiful"
- **Emphasizes**: "Resilience", "potential", "dreams", "strengths"
- **Example**: "This poor orphan desperately needs help" → "Meet [Name], a bright student who loves learning and dreams of becoming a teacher"

### What Gets Preserved
- ✅ **Religious language**: Faith references, church involvement, spiritual life
- ✅ **Cultural context**: Local customs, community traditions
- ✅ **Authentic voice**: Personal details, unique characteristics
- ✅ **Educational aspirations**: School performance, goals, interests

### What Gets Removed
- ❌ **Cost details**: Specific sponsorship amounts, financial figures
- ❌ **Graphic trauma**: Detailed abuse, violence, exploitation descriptions
- ❌ **Stigmatizing labels**: Disease-first language, deficit-based descriptions

## Setup Instructions

The AI proofreading feature requires configuration of environment variables to connect to your chosen LLM provider.

### Required Environment Variables

Add these to your `.env` file:

```bash
# Required: Your LLM provider's API key
LLM_API_KEY=your_api_key_here

# Required: API endpoint host
LLM_API_HOST=https://api.openai.com

# Optional: Model to use (defaults to gpt-4o-mini)
LLM_MODEL=gpt-4o-mini
```

### Provider-Specific Configuration

#### OpenAI
```bash
LLM_API_KEY=sk-proj-xxxxxxxxxxxxx
LLM_API_HOST=https://api.openai.com
LLM_MODEL=gpt-4o-mini  # or gpt-4o, gpt-3.5-turbo
```

#### Azure OpenAI
```bash
LLM_API_KEY=your_azure_key
LLM_API_HOST=https://your-resource.openai.azure.com
LLM_MODEL=gpt-4o-mini  # Your deployment name
```

#### Ollama (Local/Self-Hosted)
```bash
LLM_API_KEY=ollama  # Can be any string for local Ollama
LLM_API_HOST=http://localhost:11434
LLM_MODEL=llama3.2  # or mistral, phi, etc.
```

#### LM Studio (Local)
```bash
LLM_API_KEY=lm-studio  # Can be any string for local LM Studio
LLM_API_HOST=http://localhost:1234
LLM_MODEL=local-model  # Whatever model you've loaded
```

#### OpenRouter
```bash
LLM_API_KEY=sk-or-xxxxxxxxxxxxx
LLM_API_HOST=https://openrouter.ai/api
LLM_MODEL=anthropic/claude-3.5-sonnet  # or any supported model
```

### Restart Your Development Server

After configuring environment variables:

```bash
# Stop the current server (Ctrl+C)
# Then restart
npm run dev
```

## Supported Providers

This feature works with any OpenAI-compatible API, including:

| Provider | Type | Cost | Privacy | Performance |
|----------|------|------|---------|-------------|
| **OpenAI** | Cloud | $$ | Standard | Excellent |
| **Azure OpenAI** | Cloud | $$$ | Enterprise | Excellent |
| **Ollama** | Self-hosted | Free | Complete | Good |
| **LM Studio** | Local | Free | Complete | Good |
| **OpenRouter** | Aggregator | Varies | Standard | Varies |
| **Together AI** | Cloud | $ | Standard | Good |
| **Groq** | Cloud | $ | Standard | Excellent |
| **Any OpenAI-compatible** | Varies | Varies | Varies | Varies |

**Recommendation**: For production use with sensitive child data, consider self-hosted options (Ollama, LM Studio) or enterprise providers (Azure OpenAI) for maximum privacy control.

## How to Use

### Proofreading a Biography

1. Go to **Admin Panel** → **Children**
2. Click **"Add a Child"** or click **Edit** on an existing child
3. Fill in the biography field
4. Click the **"AI Proofread"** button below the biography textarea
   - **Note**: Button only appears if LLM is properly configured
5. Review the AI-transformed biography in the modal
6. Compare original vs. improved side-by-side
7. Click **"Accept AI Suggestions"** to apply, or **"Keep Original"** to discard

### Proofreading Activity Content

1. Go to **Admin Panel** → **Activities**
2. Click **"Create Activity"** or edit an existing activity
3. Fill in the title and/or description
4. Click the **"AI Proofread"** button below each field
5. Review the transformed content
6. Accept or reject suggestions

## Features

### CreatorShare-Specific Prompts

Unlike generic proofreading tools, our AI uses specialized prompts for each content type:

**Biography Proofreading**:
- Applies all dignity-first transformations
- Protects privacy (removes HIV/AIDS, graphic trauma)
- Uses person-first language
- Focuses on current life, not tragic past
- Preserves religious and cultural context
- Removes cost details

**Activity Title Proofreading**:
- Makes titles engaging and clear
- Maintains context about beneficiary activities
- Keeps appropriate length for display

**Activity Description Proofreading**:
- Improves clarity and engagement
- Maintains factual accuracy
- Uses appropriate tone for updates

### Content Transformation Intelligence

The AI understands context:
- **Medical conditions**: "HIV-positive orphan" → "child receiving medical care"
- **Disabilities**: "crippled boy" → "boy with a physical disability"
- **Family status**: "both parents died of AIDS" → "lives with grandmother"
- **Pity language**: "suffering from poverty" → "working toward educational goals"

### User Control

- **Side-by-side comparison**: See original vs. transformed
- **One-click accept/reject**: You're always in control
- **No automatic changes**: Must explicitly accept suggestions
- **Review before applying**: Understand every change

### Performance

- Fast response times (1-5 seconds depending on provider)
- Handles text up to 10,000 characters
- Works only when you click "Proofread" (no background processing)
- Graceful error handling with helpful messages

## Rate Limits

Rate limits are **provider-dependent**. Here are examples:

### OpenAI
- **Free tier**: Not available
- **Paid tier**: 
  - GPT-4o-mini: 30,000 requests/day (Tier 1)
  - GPT-4o: 500 requests/day (Tier 1)
  - Higher tiers available with usage

### Azure OpenAI
- Based on your deployment configuration
- Typically measured in tokens per minute (TPM)
- Contact your Azure admin for limits

### Ollama / LM Studio (Local)
- **No rate limits** - runs locally on your hardware
- Performance depends on your machine specs
- Completely private and free

### OpenRouter
- Varies by model and account tier
- Typically 200+ requests/minute for most models
- Check [OpenRouter docs](https://openrouter.ai/docs) for specifics

**Best Practice**: If you encounter rate limits, consider:
1. Using a local provider (Ollama/LM Studio) for unlimited requests
2. Upgrading your API tier
3. Implementing request queuing in your workflow

## Troubleshooting

### "AI proofreading is not configured" Error

**Cause**: Required environment variables are missing or incorrect.

**Solution**:
1. Verify `LLM_API_KEY` is set in `.env`
2. Verify `LLM_API_HOST` is set correctly
3. Check for typos in variable names
4. Restart your development server
5. Check server logs for specific error messages

### Button Not Appearing

**Cause**: The AI feature is not enabled on the server.

**Solution**:
1. Verify environment variables are set correctly
2. Restart the development server (`npm run dev`)
3. Check the `/api/ai/config` endpoint:
   ```bash
   curl http://localhost:3000/api/ai/config
   # Should return: {"enabled": true}
   ```
4. Check browser console for errors
5. Clear browser cache and reload

### "Rate limit exceeded" Error

**Cause**: You've hit your provider's rate limit.

**Solution**:
1. Wait before trying again (time varies by provider)
2. Check your provider's dashboard for current limits
3. Consider switching to a local provider (no limits)
4. Upgrade your API tier if needed

### Connection Errors (Network/Timeout)

**Cause**: Cannot reach the LLM provider API.

**Solution**:
1. Verify `LLM_API_HOST` is correct and accessible
2. Check your internet connection (for cloud providers)
3. For local providers (Ollama/LM Studio):
   - Ensure the service is running
   - Verify the port is correct (11434 for Ollama, 1234 for LM Studio)
   - Check firewall settings
4. Test the endpoint directly:
   ```bash
   curl $LLM_API_HOST/v1/models \
     -H "Authorization: Bearer $LLM_API_KEY"
   ```

### Poor Quality Suggestions

**Cause**: Model limitations or insufficient context.

**Solution**:
1. Provide more complete text (AI works best with full sentences)
2. Try a more capable model (e.g., gpt-4o instead of gpt-4o-mini)
3. Very short text (1-2 words) may not benefit from proofreading
4. For local models, ensure you're using a model trained for writing tasks

### Authentication Errors

**Cause**: Invalid or expired API key.

**Solution**:
1. Verify your API key is correct and active
2. Check if the key has necessary permissions
3. For Azure: Ensure you're using the correct key format
4. Regenerate the API key if necessary

## Technical Details

### Architecture

**Frontend Components**:
- `ProofreadButton.tsx` - Triggers proofreading request
- `ProofreadModal.tsx` - Displays comparison and handles acceptance

**Backend**:
- `/api/ai/proofread` - Main proofreading endpoint
- `/api/ai/config` - Returns whether AI is enabled
- Uses `openai-edge` library for OpenAI-compatible API communication

**Integration Points**:
- `BeneficiaryModal.tsx` - Biography field (uses "biography" type)
- `ActivityModals.tsx` - Title and description fields (uses "activity" type)

### Content Type Detection

The API automatically applies different prompts based on the `type` parameter:

**Biography Type** (`type: "biography"`):
- Full dignity-first transformation
- Privacy protection
- Person-first language
- Focus on present and future

**Activity Type** (`type: "activity"`):
- Clarity and engagement improvements
- Maintains factual accuracy
- Less aggressive transformation than biography

### Request Flow

```
User clicks "AI Proofread"
  ↓
Frontend calls /api/ai/proofread
  ↓
Server validates configuration
  ↓
Server constructs prompt based on type
  ↓
OpenAI-compatible API processes request
  ↓
Response returned to frontend
  ↓
Modal displays comparison
  ↓
User accepts or rejects
```

### Security

- **API key**: Stored server-side only (never exposed to browser)
- **Request validation**: All requests validated and rate-limited
- **HTTPS**: All cloud API communication over HTTPS
- **Local options**: Self-hosted Ollama/LM Studio keeps data completely private
- **No storage**: Text is not stored by most providers after processing
  - Verify your provider's data retention policy
  - Local providers guarantee no external data transmission

### Data Privacy Considerations

When working with sensitive child data:

**Recommended Providers** (Privacy-first):
1. **Ollama** (local) - No data leaves your machine
2. **LM Studio** (local) - Complete privacy control
3. **Azure OpenAI** (enterprise) - GDPR-compliant, configurable retention

**Use with Caution** (Review policies):
- OpenAI - 30-day retention, used for abuse monitoring
- OpenRouter - Varies by underlying model provider
- Other cloud providers - Check their specific policies

**Best Practice**: For maximum privacy with real child data, use self-hosted solutions (Ollama or LM Studio).

## Cost

Costs are **provider-dependent**:

### OpenAI (Pay-as-you-go)

**GPT-4o-mini** (Recommended):
- Input: $0.150 per 1M tokens (~750K words)
- Output: $0.600 per 1M tokens (~750K words)
- **Example**: 1,000 biography proofs (~500 words each) ≈ $1.50

**GPT-4o**:
- Input: $2.50 per 1M tokens
- Output: $10.00 per 1M tokens
- **Example**: 1,000 biography proofs ≈ $25.00

### Azure OpenAI
- Similar pricing to OpenAI
- Billed through Azure subscription
- May have enterprise discounts

### Local Providers (Free)
- **Ollama**: Free, open-source
- **LM Studio**: Free
- **Cost**: Only your hardware (one-time investment)

### Comparison for 10,000 Biographies/Year

| Provider | Model | Estimated Cost |
|----------|-------|----------------|
| OpenAI | gpt-4o-mini | ~$15/year |
| OpenAI | gpt-4o | ~$250/year |
| Ollama | llama3.2 | $0 (hardware only) |
| Azure | gpt-4o-mini | ~$15/year |

**Recommendation**: Start with gpt-4o-mini for excellent quality at minimal cost, or use Ollama for zero ongoing costs.

## Migration Guide

### Migrating from Google Gemini

If you previously used the Google Gemini version of this feature, follow these steps:

#### 1. Remove Old Environment Variable

```bash
# Remove this from .env:
GEMINI_API_KEY=xxxxx
```

#### 2. Add New Environment Variables

```bash
# Add these to .env:
LLM_API_KEY=your_new_api_key
LLM_API_HOST=https://api.openai.com
LLM_MODEL=gpt-4o-mini
```

#### 3. Choose Your Provider

**Option A: OpenAI (Easiest)**
1. Sign up at [platform.openai.com](https://platform.openai.com)
2. Create an API key
3. Add billing information (pay-as-you-go)
4. Set `LLM_API_KEY` and `LLM_API_HOST` as shown above

**Option B: Ollama (Free, Private)**
1. Install Ollama: [ollama.ai](https://ollama.ai)
2. Pull a model: `ollama pull llama3.2`
3. Set environment variables:
   ```bash
   LLM_API_KEY=ollama
   LLM_API_HOST=http://localhost:11434
   LLM_MODEL=llama3.2
   ```

**Option C: Keep Using Google**
You can use Google Gemini through OpenRouter:
```bash
LLM_API_KEY=your_openrouter_key  # from openrouter.ai
LLM_API_HOST=https://openrouter.ai/api
LLM_MODEL=google/gemini-flash-1.5
```

#### 4. Restart Server

```bash
npm run dev
```

#### 5. Test the Feature

1. Go to Admin → Children
2. Edit a beneficiary
3. Click "AI Proofread" on biography
4. Verify it works as expected

#### 6. Compare Quality

The OpenAI models (especially gpt-4o-mini) typically provide:
- ✅ Better adherence to prompt instructions
- ✅ More consistent transformation quality
- ✅ Better context understanding
- ✅ More nuanced language improvements

Local models (Ollama) provide:
- ✅ Complete privacy
- ✅ No ongoing costs
- ✅ No rate limits
- ⚠️ May require more powerful hardware
- ⚠️ Quality varies by model

### Code Changes Required

**None!** The migration only requires environment variable changes. The API interface remains the same.

## Support

If you encounter issues:

1. **Check this troubleshooting guide** first
2. **Verify configuration**: 
   ```bash
   # Test config endpoint
   curl http://localhost:3000/api/ai/config
   ```
3. **Check server logs** for detailed error messages
4. **Test your API key** directly:
   ```bash
   curl $LLM_API_HOST/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $LLM_API_KEY" \
     -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"test"}]}'
   ```
5. **Provider-specific help**:
   - OpenAI: [platform.openai.com/docs](https://platform.openai.com/docs)
   - Azure: [learn.microsoft.com/azure/ai-services/openai](https://learn.microsoft.com/azure/ai-services/openai/)
   - Ollama: [github.com/ollama/ollama](https://github.com/ollama/ollama)
   - OpenRouter: [openrouter.ai/docs](https://openrouter.ai/docs)

## Future Enhancements

Potential improvements:

- **Multiple suggestions**: Offer 2-3 variations to choose from
- **Custom transformation levels**: Light, standard, comprehensive
- **Batch proofreading**: Process multiple biographies at once
- **Translation support**: Multi-language biography creation
- **Tone customization**: Adjust formality, warmth, detail level
- **Change highlighting**: Show exactly what changed and why
- **Undo/redo**: Step through multiple versions
- **Templates**: Save common transformations as reusable patterns
- **Analytics**: Track transformation patterns to improve prompts

---

**Remember**: This feature exists to honor the dignity of every child we serve. Always review AI suggestions to ensure they truly represent each child's unique story with respect and authenticity.
