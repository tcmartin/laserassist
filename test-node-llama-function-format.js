/**
 * Test to understand the expected function format for node-llama-cpp
 */
async function testFunctionFormat() {
  console.log('Testing node-llama-cpp function format...');

  try {
    const path = require('path');
    const modelFileName = 'gemma-3-4b-it-Q4_0.gguf';
    const modelPath = path.join(__dirname, 'models', modelFileName);
    
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    const llama = await getLlama();
    
    const model = await llama.loadModel({ modelPath });
    const ctx = await model.createContext({contextSize: {min: 20000}});
    const session = new LlamaChatSession({ contextSequence: ctx.getSequence() });

    // Test function format
    const testFunctions = {
      test_function: {
        description: "A test function that returns a greeting",
        params: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name to greet"
            }
          },
          required: ["name"]
        },
        handler: async (params) => {
          console.log('Test function called with:', params);
          console.log('Params type:', typeof params);
          console.log('Params keys:', params ? Object.keys(params) : 'null/undefined');
          
          if (!params || !params.name) {
            return 'Error: No name provided';
          }
          return `Hello, ${params.name}!`;
        }
      }
    };

    console.log('Testing function call...');
    const response = await session.prompt(
      'Please call the test_function with the name "World"',
      { functions: testFunctions }
    );
    
    console.log('Response:', response);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testFunctionFormat().catch(console.error);