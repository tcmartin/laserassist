/**
 * Test the JSON result approach with regular function calling
 */
async function testJSONResultApproach() {
  console.log('Testing JSON result approach...');

  try {
    const path = require('path');
    const modelFileName = 'gemma-3-4b-it-Q4_0.gguf';
    const modelPath = path.join(__dirname, 'models', modelFileName);
    
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    const llama = await getLlama();
    
    const model = await llama.loadModel({ modelPath });
    const ctx = await model.createContext({contextSize: {min: 20000}});
    const session = new LlamaChatSession({ contextSequence: ctx.getSequence() });

    // Test function that returns JSON result
    const testFunctions = {
      get_weather: {
        description: "Get the current weather for a location",
        params: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "The city name"
            }
          },
          required: ["location"]
        },
        handler: async (params) => {
          console.log('Weather function called with:', params);
          
          // Return result as JSON string (as if user sent it)
          const result = {
            tool: "get_weather",
            result: `The weather in ${params.location} is sunny and 75°F`,
            success: true
          };
          
          console.log('Returning JSON result:', JSON.stringify(result));
          return JSON.stringify(result);
        }
      }
    };

    console.log('Asking about weather with JSON result approach...');
    const response = await session.prompt(
      'What is the weather like in New York?',
      { functions: testFunctions }
    );
    
    console.log('Final response:', response);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testJSONResultApproach().catch(console.error);