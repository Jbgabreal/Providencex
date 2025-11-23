import axios from 'axios';
import { getNewsGuardrailConfig } from '@providencex/shared-config';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('ScreenshotService');

export async function captureForexFactoryScreenshot(): Promise<Buffer> {
  const config = getNewsGuardrailConfig();
  const url = 'https://api.screenshotone.com/take';

  // Validate API key
  if (!config.screenshotOneAccessKey || config.screenshotOneAccessKey.trim() === '') {
    throw new Error('ScreenshotOne access key is not configured');
  }

  try {
    // ForexFactory calendar URL with explicit date parameter to ensure we get today's calendar
    const calendarUrl = 'https://www.forexfactory.com/calendar?day=today';
    
    const params = new URLSearchParams({
      access_key: config.screenshotOneAccessKey,
      url: calendarUrl,
      viewport_width: '1920',
      viewport_height: '1080',
      device_scale_factor: '1',
      format: 'png',
      image_quality: '90',
      delay: '3', // Wait 3 seconds for page to load (max 30 seconds)
      block_ads: 'true',
      block_cookie_banners: 'true',
    });

    const response = await axios.get(url, {
      params: params,
      responseType: 'arraybuffer',
      validateStatus: (status) => status === 200, // Only accept 200 as success
    });

    logger.info('Screenshot captured successfully');
    return Buffer.from(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      let errorMessage = error.message;
      
      // Try to extract error message from response
      if (error.response?.data) {
        try {
          if (Buffer.isBuffer(error.response.data)) {
            errorMessage = error.response.data.toString('utf-8');
          } else if (typeof error.response.data === 'string') {
            errorMessage = error.response.data;
          } else {
            errorMessage = JSON.stringify(error.response.data);
          }
        } catch (e) {
          // If parsing fails, use default message
        }
      }
      
      logger.error(`ScreenshotOne API error: ${errorMessage}`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        params: error.config?.params ? { ...error.config.params, access_key: '***' } : undefined,
      });
      
      // Provide helpful error messages
      if (error.response?.status === 400) {
        if (errorMessage.includes('access_key') || errorMessage.includes('invalid') || errorMessage.includes('key')) {
          throw new Error(`ScreenshotOne API key may be invalid. Please verify your SCREENSHOTONE_ACCESS_KEY in .env file. Error: ${errorMessage}`);
        }
        throw new Error(`ScreenshotOne API returned 400 Bad Request. Check API key and parameters. Error: ${errorMessage}`);
      }
      
      if (error.response?.status === 401) {
        throw new Error(`ScreenshotOne API authentication failed. Please verify your SCREENSHOTONE_ACCESS_KEY in .env file.`);
      }
      
      throw new Error(`Screenshot capture failed: ${errorMessage}`);
    }
    logger.error('Failed to capture screenshot', error);
    throw new Error(`Screenshot capture failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

