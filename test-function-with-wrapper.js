/**
 * Test function calling with explicit chat wrapper configuration
 */
async function testFunctionWithWrapper() {
  console.log('Testing function calling with chat wrapper...');

  try {
    const path = require('path');
    const modelFileName = 'gemma-3-4b-it-Q4_0.gguf';
    const modelPath = path.join(__dirname, 'models', modelFileName);
    
    const { getLlama, LlamaChatSession, resolveChatWrapper } = await import('node-llama-cpp');
    const llama = await getLlama();
    
    const model = await llama.loadModel({ modelPath });
    const ctx = await model.createContext({contextSize: {min: 20000}});
    
    // Try with custom wrapper settings to disable Jinja template function calling
    const chatWrapper = resolveChatWrapper(model, {
      customWrapperSettings: {
        jinjaTemplate: {
          functionCallMessageTemplate: "noJinja"
        }
      }
    });
    
    const session = new LlamaChatSession({ 
      contextSequence: ctx.getSequence(),
      chatWrapper: chatWrapper
    });

    // Simple test function
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
          const result = `The weather in ${params.location} is sunny and 75°F`;
          console.log('Weather function returning:', result);
          return result;
        }
      }
    };

    console.log('Asking about weather with custom wrapper...');
    const response = await session.prompt(
      'What is the weather like in New York? Please use the get_weather function to find out.',
      { functions: testFunctions }
    );
    
    console.log('Final response:', response);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testFunctionWithWrapper().catch(console.error);