/**
 * Test manual function calling by parsing responses and feeding results back
 */
async function testManualFunctionCalling() {
  console.log('Testing manual function calling...');

  try {
    const path = require('path');
    const modelFileName = 'gemma-3-4b-it-Q4_0.gguf';
    const modelPath = path.join(__dirname, 'models', modelFileName);
    
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    const llama = await getLlama();
    
    const model = await llama.loadModel({ modelPath });
    const ctx = await model.createContext({contextSize: {min: 20000}});
    const session = new LlamaChatSession({ contextSequence: ctx.getSequence() });

    // Available functions
    const availableFunctions = {
      get_weather: {
        description: "Get the current weather for a location",
        params: {
          type: "object",
          properties: {
            location: { type: "string", description: "The city name" }
          },
          required: ["location"]
        },
        handler: async (params) => {
          console.log('Weather function called with:', params);
          return `The weather in ${params.location} is sunny and 75°F`;
        }
      },
      search_web: {
        description: "Search the web for information",
        params: {
          type: "object", 
          properties: {
            query: { type: "string", description: "Search query" }
          },
          required: ["query"]
        },
        handler: async (params) => {
          console.log('Search function called with:', params);
          return `Search results for "${params.query}": Found 5 relevant articles about ${params.query}`;
        }
      }
    };

    // Function to generate function descriptions for the prompt
    function generateFunctionPrompt() {
      const functionDescriptions = Object.entries(availableFunctions).map(([name, func]) => {
        const params = func.params.properties ? 
          Object.entries(func.params.properties).map(([param, def]) => `${param}: ${def.description}`).join(', ') :
          'none';
        return `- ${name}(${params}): ${func.description}`;
      }).join('\n');

      return `You have access to the following functions. To call a function, use the exact format: FUNCTION_CALL: function_name({"param": "value"})

Available functions:
${functionDescriptions}

When you need to use a function, output exactly: FUNCTION_CALL: function_name({"param": "value"})
Then wait for the result before continuing your response.`;
    }

    // Function to detect and parse function calls
    function parseFunctionCall(response) {
      // Try JSON format first: FUNCTION_CALL: function_name({"param": "value"})
      const jsonRegex = /FUNCTION_CALL:\s*(\w+)\((\{[^}]*\})\)/;
      let match = response.match(jsonRegex);
      
      if (match) {
        const functionName = match[1];
        try {
          const params = JSON.parse(match[2]);
          return { functionName, params, fullMatch: match[0] };
        } catch (e) {
          console.error('Failed to parse JSON function parameters:', e);
        }
      }
      
      // Try simple format: FUNCTION_CALL: function_name(param="value")
      const simpleRegex = /FUNCTION_CALL:\s*(\w+)\(([^)]+)\)/;
      match = response.match(simpleRegex);
      
      if (match) {
        const functionName = match[1];
        const paramString = match[2];
        
        try {
          // Parse simple parameter format like: location="San Francisco", query="test"
          const params = {};
          const paramMatches = paramString.match(/(\w+)="([^"]+)"/g);
          
          if (paramMatches) {
            paramMatches.forEach(paramMatch => {
              const [, key, value] = paramMatch.match(/(\w+)="([^"]+)"/);
              params[key] = value;
            });
            return { functionName, params, fullMatch: match[0] };
          }
        } catch (e) {
          console.error('Failed to parse simple function parameters:', e);
        }
      }
      
      return null;
    }

    // Main conversation loop with manual function calling
    async function askWithFunctions(question) {
      const systemPrompt = generateFunctionPrompt();
      const fullPrompt = `${systemPrompt}\n\nUser: ${question}`;
      
      console.log('\nAsking:', question);
      
      let response = await session.prompt(fullPrompt);
      console.log('Initial response:', response);
      
      // Check for function calls and handle them
      let maxIterations = 5; // Prevent infinite loops
      while (maxIterations > 0) {
        const functionCall = parseFunctionCall(response);
        
        if (!functionCall) {
          // No function call found, return final response
          break;
        }
        
        console.log(`\nDetected function call: ${functionCall.functionName}`, functionCall.params);
        
        // Execute the function
        const func = availableFunctions[functionCall.functionName];
        if (!func) {
          const errorMsg = `Function ${functionCall.functionName} not found`;
          response = await session.prompt(`Function call failed: ${errorMsg}. Please continue your response without using this function.`);
          continue;
        }
        
        try {
          const result = await func.handler(functionCall.params);
          console.log('Function result:', result);
          
          // Feed the result back to the model
          const resultPrompt = `Here's the result of your function call ${functionCall.functionName}: ${result}\n\nPlease continue your response using this information.`;
          response = await session.prompt(resultPrompt);
          console.log('Response after function result:', response);
          
        } catch (error) {
          const errorMsg = `Function ${functionCall.functionName} failed: ${error.message}`;
          response = await session.prompt(`Function call failed: ${errorMsg}. Please continue your response without this information.`);
        }
        
        maxIterations--;
      }
      
      return response;
    }

    // Test the manual function calling
    const result1 = await askWithFunctions("What's the weather like in San Francisco?");
    console.log('\n=== Final Result 1 ===');
    console.log(result1);
    
    const result2 = await askWithFunctions("Search for information about JavaScript tutorials");
    console.log('\n=== Final Result 2 ===');
    console.log(result2);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testManualFunctionCalling().catch(console.error);