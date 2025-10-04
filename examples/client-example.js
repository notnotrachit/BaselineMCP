// Example MCP client usage
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testMCPServer() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js']
  });

  const client = new Client(
    {
      name: 'web-baseline-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  try {
    // Test getFeatureSupport
    console.log('Testing getFeatureSupport...');
    const featureResult = await client.request(
      { method: 'tools/call' },
      {
        name: 'getFeatureSupport',
        arguments: { featureName: 'css-has-selector' }
      }
    );
    console.log('Feature Support:', JSON.parse(featureResult.content[0].text));

    // Test listBaselineFeatures
    console.log('\nTesting listBaselineFeatures...');
    const baselineResult = await client.request(
      { method: 'tools/call' },
      {
        name: 'listBaselineFeatures',
        arguments: { year: 2024 }
      }
    );
    console.log('Baseline Features:', JSON.parse(baselineResult.content[0].text));

    // Test compareSupport
    console.log('\nTesting compareSupport...');
    const compareResult = await client.request(
      { method: 'tools/call' },
      {
        name: 'compareSupport',
        arguments: { 
          featureA: 'css-has-selector',
          featureB: 'offscreen-canvas'
        }
      }
    );
    console.log('Comparison:', JSON.parse(compareResult.content[0].text));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

testMCPServer();