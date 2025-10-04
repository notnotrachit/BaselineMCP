import express from 'express';
import cors from 'cors';
import { DataLoader } from './data-loader.js';
import { FeatureData, MCPToolResult } from './types.js';

export class SSEServer {
  private app: express.Application;
  private dataLoader: DataLoader;
  private clients: Map<string, express.Response> = new Map();
  private sessions: Map<string, { id: string; created: number }> = new Map();
  private eventCounter = 0;

  constructor() {
    this.app = express();
    this.dataLoader = new DataLoader();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(cors({
      origin: true,
      credentials: true,
      exposedHeaders: ['Mcp-Session-Id']
    }));
    this.app.use(express.json());
    
    // Security: Validate Origin header to prevent DNS rebinding attacks
    this.app.use((req, res, next) => {
      const origin = req.get('Origin');
      if (origin && !origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')) {
        return res.status(403).json({ error: 'Invalid origin' });
      }
      next();
    });
  }

  private setupRoutes(): void {
    // MCP Streamable HTTP endpoint - handles both POST and GET
    this.app.post('/', async (req, res) => {
      try {
        const sessionId = req.get('Mcp-Session-Id');
        const protocolVersion = req.get('MCP-Protocol-Version') || '2025-03-26';
        const acceptHeader = req.get('Accept') || '';
        
        // Validate protocol version
        if (!['2024-11-05', '2025-03-26', '2025-06-18'].includes(protocolVersion)) {
          return res.status(400).json({ error: 'Unsupported MCP protocol version' });
        }

        const request = req.body;
        
        // Handle different types of JSON-RPC messages
        if (!request.method) {
          // This is a response or notification
          return res.status(202).send(); // 202 Accepted with no body
        }

        // This is a request - handle it
        const response = await this.handleMCPRequest(request, sessionId);
        
        // Check if client accepts SSE
        if (acceptHeader.includes('text/event-stream')) {
          // Start SSE stream
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
            ...(response.sessionId && { 'Mcp-Session-Id': response.sessionId })
          });

          const eventId = `event-${++this.eventCounter}`;
          res.write(`id: ${eventId}\n`);
          res.write(`data: ${JSON.stringify(response.result)}\n\n`);
          
          // Keep connection open briefly, then close
          setTimeout(() => {
            res.end();
          }, 100);
        } else {
          // Return JSON response
          res.set({
            'Content-Type': 'application/json',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
            ...(response.sessionId && { 'Mcp-Session-Id': response.sessionId })
          });
          res.json(response.result);
        }
      } catch (error) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: req.body?.id || null,
          error: {
            code: -32603,
            message: 'Internal error',
            data: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    });

    // GET endpoint for SSE streams (server-initiated messages)
    this.app.get('/', (req, res) => {
      const sessionId = req.get('Mcp-Session-Id');
      const acceptHeader = req.get('Accept') || '';
      const lastEventId = req.get('Last-Event-ID');

      if (!acceptHeader.includes('text/event-stream')) {
        // Serve documentation if not requesting SSE
        return res.json({
          name: 'Web Baseline MCP Server',
          version: '1.0.0',
          transport: 'Streamable HTTP',
          mcp: {
            endpoint: 'POST /',
            sse: 'GET / (with Accept: text/event-stream)'
          },
          api: {
            features: '/api/features/:name',
            baseline: '/api/baseline/:year',
            compare: '/api/compare/:featureA/:featureB',
            health: '/health'
          }
        });
      }

      // Start SSE stream
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control, Last-Event-ID, Mcp-Session-Id',
      });

      const clientId = sessionId || `client-${Date.now()}`;
      this.clients.set(clientId, res);

      // Send initial connection event
      const eventId = `event-${++this.eventCounter}`;
      res.write(`id: ${eventId}\n`);
      res.write(`data: ${JSON.stringify({ 
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      })}\n\n`);

      req.on('close', () => {
        this.clients.delete(clientId);
      });
    });

    // DELETE endpoint for session termination
    this.app.delete('/', (req, res) => {
      const sessionId = req.get('Mcp-Session-Id');
      if (sessionId && this.sessions.has(sessionId)) {
        this.sessions.delete(sessionId);
        this.clients.delete(sessionId);
        res.status(200).send();
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // Handle OPTIONS for CORS preflight
    this.app.options('/', (req, res) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
      res.sendStatus(200);
    });

    // SSE endpoint for real-time updates (legacy)
    this.app.get('/events', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      const legacyClientId = `legacy-${Date.now()}`;
      this.clients.set(legacyClientId, res);

      // Send initial connection event
      res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

      req.on('close', () => {
        this.clients.delete(legacyClientId);
      });
    });

    // REST API endpoints
    this.app.get('/api/features/:name', async (req, res) => {
      try {
        await this.dataLoader.loadBCDData();
        const feature = this.dataLoader.getFeature(req.params.name);
        
        if (!feature) {
          return res.status(404).json({ error: 'Feature not found' });
        }

        res.json(feature);
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.get('/api/baseline/:year', async (req, res) => {
      try {
        await this.dataLoader.loadBaselineData();
        const year = parseInt(req.params.year);
        const features = this.dataLoader.getBaselineFeatures(year);
        
        res.json({ year, features });
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.app.get('/api/compare/:featureA/:featureB', async (req, res) => {
      try {
        await this.dataLoader.loadBCDData();
        const featureA = this.dataLoader.getFeature(req.params.featureA);
        const featureB = this.dataLoader.getFeature(req.params.featureB);
        
        if (!featureA || !featureB) {
          return res.status(404).json({ error: 'One or both features not found' });
        }

        const comparison = this.compareFeatures(featureA, featureB);
        res.json(comparison);
      } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Serve static documentation on GET /
    this.app.get('/', (req, res) => {
      // If it's a GET request, serve documentation
      // POST requests to / are handled by the MCP endpoint above
      res.json({
        name: 'Web Baseline MCP Server',
        version: '1.0.0',
        mcp: {
          endpoint: 'POST /',
          sse: 'GET /sse'
        },
        api: {
          features: '/api/features/:name',
          baseline: '/api/baseline/:year',
          compare: '/api/compare/:featureA/:featureB',
          health: '/health'
        },
        examples: {
          feature: '/api/features/css-has-selector',
          baseline: '/api/baseline/2024',
          compare: '/api/compare/css-has-selector/offscreen-canvas'
        }
      });
    });
  }

  private compareFeatures(featureA: FeatureData, featureB: FeatureData) {
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

  private async handleMCPRequest(request: any, sessionId?: string): Promise<{ result: any; sessionId?: string }> {
    const { method, params, id } = request;

    try {
      switch (method) {
        case 'initialize':
          // Generate session ID for new sessions
          const newSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          this.sessions.set(newSessionId, { id: newSessionId, created: Date.now() });
          
          return {
            result: {
              jsonrpc: '2.0',
              id,
              result: {
                protocolVersion: '2025-06-18',
                capabilities: {
                  tools: {},
                },
                serverInfo: {
                  name: 'web-baseline-server',
                  version: '1.0.0',
                },
              },
            },
            sessionId: newSessionId
          };

        case 'tools/list':
          return {
            result: {
              jsonrpc: '2.0',
              id,
              result: {
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
                ],
              },
            }
          };

        case 'tools/call':
          const toolResult = await this.handleToolCall(params);
          return {
            result: {
              jsonrpc: '2.0',
              id,
              result: toolResult,
            }
          };

        default:
          return {
            result: {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: 'Method not found',
              },
            }
          };
      }
    } catch (error) {
      return {
        result: {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: 'Internal error',
            data: error instanceof Error ? error.message : 'Unknown error',
          },
        }
      };
    }
  }

  private async handleToolCall(params: any): Promise<MCPToolResult> {
    const { name, arguments: args } = params;

    await this.dataLoader.loadBCDData();
    await this.dataLoader.loadBaselineData();

    switch (name) {
      case 'getFeatureSupport':
        return await this.getFeatureSupport(args?.featureName as string);
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
  }

  private async getFeatureSupport(featureName: string): Promise<MCPToolResult> {
    const feature = this.dataLoader.getFeature(featureName);
    if (!feature) {
      return {
        content: [
          {
            type: 'text',
            text: `Feature "${featureName}" not found. Available features include: css-has-selector, offscreen-canvas, webusb, fetch-streaming`,
          },
        ],
      };
    }

    const result = {
      name: feature.name,
      description: feature.description,
      baselineYear: feature.baseline?.high ? new Date(feature.baseline.high).getFullYear() : null,
      baselineStatus: feature.baseline ? 'Baseline' : 'Not in Baseline',
      browserSupport: feature.support,
      links: {
        mdn: feature.mdn_url,
        spec: feature.spec_url,
      },
      status: feature.status,
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

  private async listBaselineFeatures(year: number): Promise<MCPToolResult> {
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

  private async compareSupport(featureA: string, featureB: string): Promise<MCPToolResult> {
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

  public broadcastUpdate(data: any): void {
    const message = `data: ${JSON.stringify({ type: 'update', data, timestamp: Date.now() })}\n\n`;
    
    for (const [clientId, client] of this.clients) {
      try {
        client.write(message);
      } catch (error) {
        this.clients.delete(clientId);
      }
    }
  }

  public start(port: number = 3001): void {
    // Bind only to localhost for security
    this.app.listen(port, '127.0.0.1', () => {
      console.log(`MCP Streamable HTTP Server running on http://127.0.0.1:${port}`);
      console.log(`MCP Endpoint: POST/GET http://127.0.0.1:${port}/`);
      console.log(`API: http://127.0.0.1:${port}/api`);
    }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is busy, trying ${port + 1}...`);
        this.start(port + 1);
      } else {
        console.error('Server error:', err);
      }
    });
  }
}