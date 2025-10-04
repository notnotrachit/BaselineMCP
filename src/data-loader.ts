import fetch from 'node-fetch';
import { FeatureData, BaselineFeature } from './types.js';

type AnyRecord = Record<string, any>;

export class DataLoader {
  // Backwards-compatible cache keyed by feature id
  private bcdCache: Map<string, FeatureData> = new Map();
  private baselineCache: Map<number, BaselineFeature[]> = new Map();
  private lastUpdate: number = 0;
  private readonly CACHE_TTL = 1000 * 60 * 60; // 1 hour

  // Full web-features exports (if available)
  private featuresMap: AnyRecord | null = null; // features export (keyed by id)
  private groups: AnyRecord | null = null;
  private browsers: AnyRecord | null = null;
  private snapshots: AnyRecord | null = null;

  /**
   * Load BCD-like data into the local cache. This will attempt to load the
   * `web-features` package exports (features, groups, browsers, snapshots).
   * If the package isn't available we'll fall back to the sample data included
   * in this repository for development and tests.
   */
  async loadBCDData(): Promise<void> {
    if (Date.now() - this.lastUpdate < this.CACHE_TTL && this.bcdCache.size > 0) {
      return;
    }

    // Try to dynamically import the `web-features` package so environments
    // without the package won't blow up at module load time.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = await import('web-features').catch(() => null);

      if (mod && (mod.features || mod.default)) {
        // web-features may export features as a named export or default
        const features = (mod.features || mod.default?.features) as AnyRecord;
        this.featuresMap = features || null;
        this.groups = mod.groups || mod.default?.groups || null;
        this.browsers = mod.browsers || mod.default?.browsers || null;
        this.snapshots = mod.snapshots || mod.default?.snapshots || null;

        if (this.featuresMap) {
          for (const [id, f] of Object.entries(this.featuresMap)) {
            // Coerce into our FeatureData shape where possible, but keep other
            // properties available on the object for callers who need them.
            const mapped: FeatureData = {
              name: f.name || id,
              description: f.description || f.summary || undefined,
              mdn_url: f.mdn_url || f.mdn_url || undefined,
              spec_url: f.spec || undefined,
              baseline: f.status?.baseline || undefined,
              support: f.status?.support || f.support || {},
              status: {
                experimental: !!f.status?.experimental || !!f.experimental,
                standard_track: !!f.status?.standard_track || !!f.standard_track,
                deprecated: !!f.status?.deprecated || !!f.deprecated
              }
            };

            this.bcdCache.set(id, mapped);
          }
        }
      } else {
        // no web-features available; use the sample data included in project
        const sampleData = this.getSampleBCDData();
        for (const [key, data] of Object.entries(sampleData)) {
          this.bcdCache.set(key, data as FeatureData);
        }
      }

      this.lastUpdate = Date.now();
    } catch (error) {
      console.error('Failed to load web-features or sample BCD data:', error);

      // Fallback to sample data
      const sampleData = this.getSampleBCDData();
      for (const [key, data] of Object.entries(sampleData)) {
        this.bcdCache.set(key, data as FeatureData);
      }
    }
  }

  async loadBaselineData(): Promise<void> {
    // Load baseline definitions (sample/fallback data)
    const baselineData = this.getSampleBaselineData();

    for (const [year, features] of Object.entries(baselineData)) {
      this.baselineCache.set(parseInt(year), features as BaselineFeature[]);
    }
  }

  /** Returns the raw feature object from web-features (if available) */
  getRawFeature(id: string): AnyRecord | undefined {
    return this.featuresMap ? this.featuresMap[id] : undefined;
  }

  getFeature(name: string): FeatureData | undefined {
    // Normalize feature name
    const normalizedName = this.normalizeFeatureName(name);

    // Prefer featuresMap if present
    if (this.featuresMap && this.featuresMap[normalizedName]) {
      // Return the mapped FeatureData from bcdCache (populated in load)
      return this.bcdCache.get(normalizedName) || (this.featuresMap[normalizedName] as FeatureData);
    }

    return this.bcdCache.get(normalizedName) || this.bcdCache.get(name);
  }

  getBaselineFeatures(year: number): BaselineFeature[] {
    return this.baselineCache.get(year) || [];
  }

  getAllFeatures(): FeatureData[] {
    // If we have the full features map, return those values; otherwise use cache
    if (this.featuresMap) {
      return Object.keys(this.featuresMap).map(k => this.bcdCache.get(k) as FeatureData).filter(Boolean);
    }
    return Array.from(this.bcdCache.values());
  }

  /**
   * Find features by a free-text query. This searches feature id, name,
   * description, and compat_features (if available) using a simple
   * case-insensitive substring match and returns a small result set.
   */
  findFeatures(query: string, limit: number = 10): Array<{ id: string; name: string; description?: string; group?: string }> {
    const q = (query || '').toLowerCase().trim();
    if (!q) return [];

    const results: Array<{ id: string; name: string; description?: string; group?: string }> = [];

    // Prefer using featuresMap when available to get ids
    const entries = this.featuresMap ? Object.entries(this.featuresMap) : Array.from(this.bcdCache.entries());

    for (const [id, rawOrFeature] of entries) {
      if (results.length >= limit) break;

      // rawOrFeature may be the raw object (when featuresMap) or FeatureData
      const raw = this.featuresMap ? (rawOrFeature as any) : undefined;
      const feature = this.bcdCache.get(id) as FeatureData | undefined || (rawOrFeature as FeatureData);

      const name = (feature && feature.name) || (raw && raw.name) || id;
      const description = (feature && feature.description) || (raw && raw.description) || '';
  const group = raw?.group || undefined;

      const hay = [id, name, description, ...(raw?.compat_features || [])].filter(Boolean).join(' ').toLowerCase();

      if (hay.includes(q)) {
        results.push({ id, name, description, group });
      }
    }

    return results.slice(0, limit);
  }

  getGroups(): AnyRecord | null {
    return this.groups;
  }

  getBrowsers(): AnyRecord | null {
    return this.browsers;
  }

  getSnapshots(): AnyRecord | null {
    return this.snapshots;
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