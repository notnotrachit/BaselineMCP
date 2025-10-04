export interface BrowserSupport {
  chrome?: string | boolean;
  edge?: string | boolean;
  firefox?: string | boolean;
  safari?: string | boolean;
  chrome_android?: string | boolean;
  firefox_android?: string | boolean;
  safari_ios?: string | boolean;
}

export interface BaselineStatus {
  high?: string;
  low?: string;
}

export interface FeatureData {
  name: string;
  description?: string;
  mdn_url?: string;
  spec_url?: string;
  baseline?: BaselineStatus;
  support: BrowserSupport;
  status?: {
    experimental?: boolean;
    standard_track?: boolean;
    deprecated?: boolean;
  };
}

export interface BaselineFeature {
  name: string;
  year: number;
  quarter?: string;
  description?: string;
  mdn_url?: string;
}

export interface ComparisonResult {
  featureA: FeatureData;
  featureB: FeatureData;
  baselineDifference?: {
    yearDiff: number;
    aFirst: boolean;
  };
  supportDifference: {
    browser: string;
    aVersion?: string;
    bVersion?: string;
    difference?: number;
  }[];
}

export interface MCPToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}