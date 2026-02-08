/**
 * Test the improved logging for function calls
 */
async function testImprovedLogging() {
  console.log('Testing improved logging...');

  try {
    const path = require('path');
    const modelFileName = 'gemma-3-4b-it-Q4_0.gguf';
    const modelPath = path.join(__dirname, 'models', modelFileName);
    
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    const llama = await getLlama();
    
    const model = await llama.loadModel({ modelPath });
    const ctx = await model.createContext({contextSize: {min: 20000}});
    const session = new LlamaChatSession({ contextSequence: ctx.getSequence() });

    // Test function with improved logging format
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
          console.log('🔧 [TEST FUNCTION] Weather function called with:', params);
          
          // Simulate the improved logging format
          const result = `The weather in ${params.location} is sunny and 75°F`;
          const functionResponse = {
            _source: "FUNCTION_CALL_RESULT",
            _function: "get_weather",
            _tool: "get_weather",
            _server: "test",
            _timestamp: new Date().toISOString(),
            _duration_ms: 100,
            tool: "get_weather",
            result: result,
            success: true
          };
          
          const jsonResponse = `[FUNCTION_CALL_RESULT] ${JSON.stringify(functionResponse, null, 2)}`;
          console.log('📤 [TEST FUNCTION] Returning JSON response:', jsonResponse);
          return jsonResponse;
        }
      }
    };

    console.log('🧠 [TEST] Starting LLM session with improved logging...');
    const response = await session.prompt(
      'What is the weather like in San Francisco?',
      { functions: testFunctions }
    );
    
    console.log('✅ [TEST] Final response:', response);
    
  } catch (error) {
    console.error('❌ [TEST] Test failed:', error);
  }
}

testImprovedLogging().catch(console.error);