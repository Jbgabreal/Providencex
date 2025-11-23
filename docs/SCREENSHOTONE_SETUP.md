# ScreenshotOne API Setup

The News Guardrail service uses ScreenshotOne to capture screenshots of ForexFactory's economic calendar.

## Getting Your ScreenshotOne API Key

1. **Sign up for ScreenshotOne:**
   - Go to [screenshotone.com](https://screenshotone.com)
   - Sign up for a free account (includes limited credits)
   - Or sign up for a paid plan for production use

2. **Get Your Access Key:**
   - After signing up, go to your dashboard
   - Navigate to **API** or **Settings** → **API Keys**
   - Copy your **Access Key** (it should be a long string, not just a few characters)

3. **Verify Key Format:**
   - ScreenshotOne access keys are typically long alphanumeric strings
   - Example format: `abc123def456ghi789...` (much longer)
   - If your key is very short (like `guteSAY1wPM4ig`), it might be incomplete or incorrect

4. **Add to .env:**
   ```bash
   SCREENSHOTONE_ACCESS_KEY=your_full_access_key_here
   ```

## Testing Your API Key

You can test your ScreenshotOne API key manually:

```bash
# Replace YOUR_KEY with your actual access key
curl "https://api.screenshotone.com/take?access_key=YOUR_KEY&url=https://example.com&viewport_width=1920&viewport_height=1080&format=png" --output test.png
```

If successful, you'll get a PNG image file. If not, you'll get an error message indicating what's wrong.

## Common Errors

### 400 Bad Request
- **Invalid API key**: Verify your access key is correct and complete
- **Invalid parameters**: Check the API request format
- **Free tier limits**: You may have exceeded your free tier quota

### 401 Unauthorized
- **API key missing or incorrect**: Double-check your `.env` file
- **Key expired or revoked**: Generate a new key in ScreenshotOne dashboard

## Free Tier Limitations

ScreenshotOne's free tier includes:
- Limited number of screenshots per month
- May have rate limits
- For production use, consider upgrading to a paid plan

## Alternative: Use ScreenshotOne Self-Hosted

If you have ScreenshotOne self-hosted, you can configure a custom endpoint in the service code.

