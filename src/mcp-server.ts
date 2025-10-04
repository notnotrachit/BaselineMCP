import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { DataLoader } from './data-loader.js';
import { FeatureData, ComparisonResult, MCPToolResult } from './types.js';

export class WebBaselineMCPServer {
  private server: Server;
  private dataLoader: DataLoader;

  constructor() {
    this.server = new Server(
      {
        name: 'web-baseline-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.dataLoader = new DataLoader();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'getFeatureSupport',
            description: 'Get browser support and baseline data for a web feature',
            inputSchema: {
              type: 'object',
              properties: {
                featureName: {
                  type: 'string',
                  description: 'Name of the web feature (e.g., "css-has-selector", "offscreen-canvas")',
                },
              },
              required: ['featureName'],
            },
          },
          {
            name: 'findFeatureId',
            description: 'Search for feature ids by free-text query',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                limit: { type: 'number' },
              },
              required: ['query'],
            },
          },
          {
            name: 'listBaselineFeatures',
            description: 'List all features included in a specific Baseline year',
            inputSchema: {
              type: 'object',
              properties: {
                year: {
                  type: 'number',
                  description: 'Baseline year (e.g., 2024, 2023)',
                },
              },
              required: ['year'],
            },
          },
          {
            name: 'compareSupport',
            description: 'Compare browser support between two web features',
            inputSchema: {
              type: 'object',
              properties: {
                featureA: {
                  type: 'string',
                  description: 'First feature name',
                },
                featureB: {
                  type: 'string',
                  description: 'Second feature name',
                },
              },
              required: ['featureA', 'featureB'],
            },
          },
        ] as Tool[],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'getFeatureSupport':
            return await this.getFeatureSupport(args?.featureName as string);
          case 'findFeatureId':
            return await this.findFeatureId(args?.query as string, args?.limit as number);
          case 'listBaselineFeatures':
            return await this.listBaselineFeatures(args?.year as number);
          case 'compareSupport':
            return await this.compareSupport(
              args?.featureA as string,
              args?.featureB as string
            );
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    });
  }

  private async getFeatureSupport(featureName: string): Promise<CallToolResult> {
    await this.dataLoader.loadBCDData();
    
    const feature = this.dataLoader.getFeature(featureName);
    const raw = this.dataLoader.getRawFeature(featureName);
    if (!feature) {
      const available = this.dataLoader.getAllFeatures().map(f => f.name || '').filter(Boolean);
      return {
        content: [
          {
            type: 'text',
            text: `Feature "${featureName}" not found. Available features: ${available.join(', ')}`,
          },
        ],
      };
    }

    const result = {
      id: raw?.id || feature.name,
      name: feature.name,
      description: feature.description,
      description_html: raw?.description_html,
      group: raw?.group,
      baseline: raw?.status?.baseline || feature.baseline,
      baselineYear: feature.baseline?.high ? new Date(feature.baseline.high).getFullYear() : null,
      baselineStatus: feature.baseline ? 'Baseline' : 'Not in Baseline',
      browserSupport: raw?.status?.support || feature.support,
      compat_features: raw?.compat_features || undefined,
      links: {
        mdn: feature.mdn_url,
        spec: raw?.spec || feature.spec_url,
      },
      status: raw?.status || feature.status,
      raw: raw || undefined,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async listBaselineFeatures(year: number): Promise<CallToolResult> {
    await this.dataLoader.loadBaselineData();
    
    const features = this.dataLoader.getBaselineFeatures(year);
    
    if (features.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No Baseline features found for year ${year}. Available years: 2022, 2023, 2024`,
          },
        ],
      };
    }

    const result = {
      year,
      count: features.length,
      features: features.map(f => ({
        name: f.name,
        quarter: f.quarter,
        description: f.description,
      })),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async compareSupport(featureA: string, featureB: string): Promise<CallToolResult> {
    await this.dataLoader.loadBCDData();
    
    const dataA = this.dataLoader.getFeature(featureA);
    const dataB = this.dataLoader.getFeature(featureB);

    if (!dataA || !dataB) {
      return {
        content: [
          {
            type: 'text',
            text: `One or both features not found: "${featureA}", "${featureB}"`,
          },
        ],
      };
    }

    const comparison = this.compareFeatures(dataA, dataB);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(comparison, null, 2),
        },
      ],
    };
  }

  private async findFeatureId(query: string, limit: number = 10): Promise<CallToolResult> {
    await this.dataLoader.loadBCDData();

    const results = this.dataLoader.findFeatures(query, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ query, count: results.length, results }, null, 2),
        },
      ],
    };
  }

  private compareFeatures(featureA: FeatureData, featureB: FeatureData): ComparisonResult {
    const supportDifference = [];
    const browsers = ['chrome', 'edge', 'firefox', 'safari'] as const;

    for (const browser of browsers) {
      const aSupport = featureA.support[browser];
      const bSupport = featureB.support[browser];
      
      supportDifference.push({
        browser,
        aVersion: typeof aSupport === 'string' ? aSupport : aSupport ? 'supported' : 'not supported',
        bVersion: typeof bSupport === 'string' ? bSupport : bSupport ? 'supported' : 'not supported',
      });
    }

    let baselineDifference;
    if (featureA.baseline?.high && featureB.baseline?.high) {
      const yearA = new Date(featureA.baseline.high).getFullYear();
      const yearB = new Date(featureB.baseline.high).getFullYear();
      baselineDifference = {
        yearDiff: Math.abs(yearA - yearB),
        aFirst: yearA < yearB,
      };
    }

    return {
      featureA,
      featureB,
      baselineDifference,
      supportDifference,
    };
  }

  async start(): Promise<void> {
    await this.dataLoader.loadBCDData();
    await this.dataLoader.loadBaselineData();
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Web Baseline MCP Server running on stdio');
  }
}