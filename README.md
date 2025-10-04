# Web Baseline MCP Server

An MCP (Model Context Protocol) server that provides Web Baseline compatibility data with Server-Sent Events (SSE) support.

## Features

- Query Web Baseline feature support data
- List features by Baseline year
- Compare browser support between features
- Real-time updates via Server-Sent Events
- Caching for performance
- Normalized feature name resolution

## Installation

```bash
npm install
npm run build
```

## Usage

### Install Dependencies
```bash
npm install
```

### Build the Project
```bash
npm run build
```

### Run as MCP Server (Default)
```bash
npm start
# or
node dist/index.js
```

### Run as SSE Server
```bash
npm start sse
# or
node dist/index.js sse
```

### Development Mode
```bash
npm run dev          # MCP server
npm run dev sse      # SSE server
```

### Testing
```bash
npm test
```

## MCP Tools

### getFeatureSupport
Query support data for a specific web feature.

**Input:** `{ featureName: string }`
**Output:** Feature support data including baseline year and browser matrix

### listBaselineFeatures
List all features included in a specific Baseline year.

**Input:** `{ year: number }`
**Output:** Array of features with metadata

### compareSupport
Compare browser support between two features.

**Input:** `{ featureA: string, featureB: string }`
**Output:** Comparison data showing adoption differences

## Example Queries

- "Is CSS :has() in Baseline 2024?"
- "Show me all features added in Baseline 2023"
- "Compare support for fetch streaming vs WebUSB"

## Configuration

The server runs on port 3001 by default. Configure via environment variables:

- `PORT`: Server port (default: 3001)
- `MCP_SERVER_NAME`: Server name for MCP (default: "web-baseline")

## Server-Sent Events (SSE) API

When running in SSE mode, the server provides both REST endpoints and real-time updates:

### REST Endpoints

- `GET /` - Server information and available endpoints
- `GET /api/features/:name` - Get feature support data
- `GET /api/baseline/:year` - List baseline features for a year
- `GET /api/compare/:featureA/:featureB` - Compare two features
- `GET /events` - SSE endpoint for real-time updates
- `GET /health` - Health check

### Example SSE Usage

```javascript
const eventSource = new EventSource('http://localhost:3001/events');

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

### Example REST API Calls

```bash
# Get CSS :has() selector support
curl http://localhost:3001/api/features/css-has-selector

# List 2024 baseline features
curl http://localhost:3001/api/baseline/2024

# Compare two features
curl http://localhost:3001/api/compare/css-has-selector/offscreen-canvas
```

## MCP Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "web-baseline": {
      "command": "node",
      "args": ["path/to/web-baseline-mcp-server/dist/index.js"],
      "env": {
        "NODE_ENV": "production"
      },
      "disabled": false,
      "autoApprove": [
        "getFeatureSupport",
        "listBaselineFeatures", 
        "compareSupport"
      ]
    }
  }
}
```

## Sample Data

The server includes sample data for these features:
- `css-has-selector` - CSS :has() pseudo-class
- `offscreen-canvas` - OffscreenCanvas API
- `webusb` - WebUSB API
- `fetch-streaming` - Fetch API streaming support

## Extending the Server

To add real MDN BCD data:

1. Install `@mdn/browser-compat-data`
2. Update `DataLoader.loadBCDData()` to fetch from the package
3. Add feature name normalization for common aliases
4. Implement caching with TTL for performance

## Architecture

- **MCP Server**: Provides tools via Model Context Protocol
- **SSE Server**: REST API + Server-Sent Events for real-time updates
- **Data Loader**: Handles BCD and Baseline data with caching
- **Type Definitions**: TypeScript interfaces for all data structures