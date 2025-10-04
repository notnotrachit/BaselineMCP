import fetch from 'node-fetch';
import { FeatureData, BaselineFeature } from './types.js';

export class DataLoader {
  private bcdCache: Map<string, FeatureData> = new Map();
  private baselineCache: Map<number, BaselineFeature[]> = new Map();
  private lastUpdate: number = 0;
  private readonly CACHE_TTL = 1000 * 60 * 60; // 1 hour

  async loadBCDData(): Promise<void> {
    if (Date.now() - this.lastUpdate < this.CACHE_TTL && this.bcdCache.size > 0) {
      return;
    }

    try {
      // Load sample BCD data - in production, you'd fetch from MDN's GitHub
      const sampleData = this.getSampleBCDData();
      
      for (const [key, data] of Object.entries(sampleData)) {
        this.bcdCache.set(key, data as FeatureData);
      }

      this.lastUpdate = Date.now();
    } catch (error) {
      console.error('Failed to load BCD data:', error);
    }
  }

  async loadBaselineData(): Promise<void> {
    // Load baseline definitions
    const baselineData = this.getSampleBaselineData();
    
    for (const [year, features] of Object.entries(baselineData)) {
      this.baselineCache.set(parseInt(year), features as BaselineFeature[]);
    }
  }

  getFeature(name: string): FeatureData | undefined {
    // Normalize feature name
    const normalizedName = this.normalizeFeatureName(name);
    return this.bcdCache.get(normalizedName) || this.bcdCache.get(name);
  }

  getBaselineFeatures(year: number): BaselineFeature[] {
    return this.baselineCache.get(year) || [];
  }

  getAllFeatures(): FeatureData[] {
    return Array.from(this.bcdCache.values());
  }

  private normalizeFeatureName(name: string): string {
    // Convert common variations to standard names
    const normalizations: Record<string, string> = {
      'css :has()': 'css-has-selector',
      'css has': 'css-has-selector',
      'offscreen canvas': 'offscreen-canvas',
      'web usb': 'webusb',
      'fetch streaming': 'fetch-streaming'
    };

    const lower = name.toLowerCase();
    return normalizations[lower] || name;
  }

  private getSampleBCDData() {
    return {
      'css-has-selector': {
        name: 'CSS :has() selector',
        description: 'The :has() CSS pseudo-class represents an element if any of the selectors passed as parameters match at least one element.',
        mdn_url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:has',
        baseline: { high: '2023-12-01', low: '2023-03-01' },
        support: {
          chrome: '105',
          edge: '105',
          firefox: '121',
          safari: '15.4'
        },
        status: { standard_track: true }
      },
      'offscreen-canvas': {
        name: 'OffscreenCanvas',
        description: 'The OffscreenCanvas interface provides a canvas that can be rendered off screen.',
        mdn_url: 'https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas',
        baseline: { high: '2022-03-01', low: '2021-09-01' },
        support: {
          chrome: '69',
          edge: '79',
          firefox: '105',
          safari: '16.4'
        },
        status: { standard_track: true }
      },
      'webusb': {
        name: 'WebUSB API',
        description: 'The WebUSB API provides a way to safely expose USB device services to the web.',
        mdn_url: 'https://developer.mozilla.org/en-US/docs/Web/API/USB',
        support: {
          chrome: '61',
          edge: '79',
          firefox: false,
          safari: false
        },
        status: { experimental: true }
      },
      'fetch-streaming': {
        name: 'Fetch Streaming',
        description: 'Streaming support for the Fetch API using ReadableStream.',
        mdn_url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#processing_a_text_file_line_by_line',
        baseline: { high: '2022-07-01', low: '2020-01-01' },
        support: {
          chrome: '43',
          edge: '14',
          firefox: '65',
          safari: '10.1'
        },
        status: { standard_track: true }
      }
    };
  }

  private getSampleBaselineData() {
    return {
      2024: [
        {
          name: 'css-has-selector',
          year: 2024,
          quarter: 'Q1',
          description: 'CSS :has() pseudo-class selector'
        }
      ],
      2023: [
        {
          name: 'css-has-selector',
          year: 2023,
          quarter: 'Q4',
          description: 'CSS :has() pseudo-class selector'
        }
      ],
      2022: [
        {
          name: 'offscreen-canvas',
          year: 2022,
          quarter: 'Q1',
          description: 'OffscreenCanvas API'
        },
        {
          name: 'fetch-streaming',
          year: 2022,
          quarter: 'Q3',
          description: 'Fetch API streaming support'
        }
      ]
    };
  }
}