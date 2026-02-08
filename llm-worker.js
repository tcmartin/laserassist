const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const MCPManager = require('./mcp-manager');
const MCPConfigManager = require('./mcp-config-manager');
const MCPFunctionAdapter = require('./mcp-function-adapter');

// Request queue to handle both chat and analysis requests with performance optimizations
class RequestQueue {
  constructor() {
    this.chatQueue = [];
    this.analysisQueue = [];
    this.processing = false;
    this.lastProcessTime = 0;
    this.processingStats = {
      chatRequests: 0,
      analysisRequests: 0,
      averageChatTime: 0,
      averageAnalysisTime: 0
    };
  }

  addChatRequest(request) {
    // Limit chat queue size to prevent memory issues
    if (this.chatQueue.length > 10) {
      this.chatQueue.shift(); // Remove oldest request
    }

    this.chatQueue.push({
      ...request,
      timestamp: Date.now(),
      type: 'chat'
    });
    this.processNext();
  }

  addAnalysisRequest(request) {
    // Limit analysis queue size and remove duplicates
    if (this.analysisQueue.length > 5) {
      this.analysisQueue.shift(); // Remove oldest request
    }

    this.analysisQueue.push({
      ...request,
      timestamp: Date.now(),
      type: 'analysis'
    });
    this.processNext();
  }

  async processNext() {
    if (this.processing) return;

    // Prioritize chat requests over analysis requests
    const request = this.chatQueue.shift() || this.analysisQueue.shift();
    if (!request) return;

    this.processing = true;
    const startTime = Date.now();

    try {
      // Handle requests with appropriate timeout handling
      if (request.type === 'chat') {
        // Keep timeout for chat to maintain responsiveness
        await Promise.race([
          request.handler(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Chat request timeout')), 60000); // 60s for chat
          })
        ]);
      } else {
        // No timeout for analysis - let it take as long as needed
        await request.handler();
      }

      // Update performance stats
      const processingTime = Date.now() - startTime;
      this.updateStats(request.type, processingTime);

    } catch (err) {
      console.error('Request processing error:', err);
      // Handle timeout or other errors gracefully
      if (err.message === 'Request timeout') {
        parentPort.postMessage({
          type: 'performance-warning',
          message: `${request.type} request timed out - local LLM may be overloaded`
        });
      }
    } finally {
      this.processing = false;
      this.lastProcessTime = Date.now();

      // Use setImmediate to yield control back to event loop immediately
      // This ensures audio processing and other tasks can run between LLM requests
      setImmediate(() => {
        if (this.chatQueue.length > 0 || this.analysisQueue.length > 0) {
          this.processNext();
        }
      });
    }
  }

  updateStats(type, processingTime) {
    if (type === 'chat') {
      this.processingStats.chatRequests++;
      this.processingStats.averageChatTime =
        (this.processingStats.averageChatTime + processingTime) / 2;
    } else {
      this.processingStats.analysisRequests++;
      this.processingStats.averageAnalysisTime =
        (this.processingStats.averageAnalysisTime + processingTime) / 2;
    }
  }

  getAdaptiveDelay() {
    // Adaptive delay based on queue size and recent performance
    const queueSize = this.chatQueue.length + this.analysisQueue.length;
    const baseDelay = 100; // Base 100ms delay

    if (queueSize > 3) return baseDelay * 2; // Slow down if queue is building up
    if (this.processingStats.averageChatTime > 10000) return baseDelay * 1.5; // Slow down if LLM is struggling

    return baseDelay;
  }

  getQueueStatus() {
    return {
      chatQueue: this.chatQueue.length,
      analysisQueue: this.analysisQueue.length,
      processing: this.processing,
      stats: this.processingStats
    };
  }
}

// Analysis prompt templates
const ANALYSIS_PROMPTS = {
  summary: (transcript, context, timeRange) => `Summarize this conversation in 2-3 sentences:

${transcript}

Focus on key points and decisions.`,

  suggestions: (transcript, context) => `Based on this conversation, provide actionable suggestions and interactive activities in JSON format:

${transcript}

Respond with JSON only:
{
  "actionItems": ["suggestion1", "suggestion2"],
  "questions": ["question1"],
  "topics": ["topic1"],
  "activities": [
    {
      "type": "define",
      "entity": "technical term or concept mentioned",
      "displayText": "Define: [entity]",
      "confidence": 0.8
    },
    {
      "type": "explain", 
      "entity": "process or method discussed",
      "displayText": "Explain: [entity]",
      "confidence": 0.7
    }
  ]
}

Generate 1-3 interactive activities for entities, concepts, technologies, or processes mentioned in the conversation. Activity types: define, explain, research, example.`,

  activities: (transcript, context) => `Based on this conversation, generate a bulleted list of interactive activities:

${transcript}

Provide activities that users can engage with based on the conversation content. Focus on actionable items like definitions, explanations, research topics, or examples.`


};

(async () => {
  try {
    parentPort.postMessage({ type: 'status', message: 'Loading LLM model...' });

    const modelFileName = workerData?.modelFileName || 'gemma-3-4b-it-Q4_0.gguf';
    
    // Use userData for packaged apps to avoid ASAR issues
    let modelPath;
    if (workerData?.userDataPath) {
      // Packaged app - use userData directory passed from main process
      modelPath = path.join(workerData.userDataPath, 'models', modelFileName);
    } else {
      // Development - use local models directory
      modelPath = path.join(__dirname, 'models', modelFileName);
    }

    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
    const llama = await getLlama();

    try {
      const model = await llama.loadModel({ modelPath,  defaultContextFlashAttention: true });
      const ctx = await model.createContext({ contextSize: { min: 20000 } });
      const session = new LlamaChatSession({ contextSequence: ctx.getSequence() });
      const requestQueue = new RequestQueue();

      // Initialize MCP Manager (disabled for MAS builds)
      const isMASBuild = process.env.MAS_BUILD === 'true';
      let mcpFunctions = {};
      let mcpManager = null;
      let mcpFunctionAdapter = null;
      
      if (!isMASBuild) {
        parentPort.postMessage({ type: 'status', message: `Initializing MCP connections... (Model: ${modelFileName})` });
        const MCPConfigManager = require('./mcp-config-manager');
        const MCPManager = require('./mcp-manager');
        const MCPFunctionAdapter = require('./mcp-function-adapter');
        
        const mcpConfigManager = new MCPConfigManager();
        mcpManager = new MCPManager(mcpConfigManager);
        mcpFunctionAdapter = new MCPFunctionAdapter(mcpManager);

        // Initialize MCP (non-blocking)
        try {
          console.log(`\n🚀 [MCP INIT] Initializing MCP Manager...`);
          await mcpManager.initialize();
          mcpFunctions = await mcpFunctionAdapter.getAllMCPFunctions();

          console.log(`✅ [MCP INIT SUCCESS] Loaded ${Object.keys(mcpFunctions).length} MCP functions`);
          if (Object.keys(mcpFunctions).length > 0) {
            console.log(`📋 [MCP FUNCTIONS] Available functions:`);
            Object.keys(mcpFunctions).forEach((funcName, index) => {
              const func = mcpFunctions[funcName];
              console.log(`   ${index + 1}. ${funcName}`);
              console.log(`      Description: ${func.description || 'No description'}`);
              console.log(`      Parameters: ${func.params ? Object.keys(func.params.properties || {}).join(', ') || 'none' : 'none'}`);
            });
          }
        } catch (error) {
          console.error('❌ [MCP INIT ERROR] MCP initialization failed, continuing without MCP functions:', error);
        }
      } else {
        console.log(`\n🚫 [MCP DISABLED] MCP functionality disabled for MAS build`);
        parentPort.postMessage({ type: 'status', message: `MCP disabled for App Store version (Model: ${modelFileName})` });
      }

      // Listen for MCP connection changes to refresh functions (only if MCP enabled)
      if (mcpManager) {
        mcpManager.on('server-connected', async (serverId) => {
          try {
            console.log(`\n🔄 [MCP REFRESH] Server connected: ${serverId}`);
            mcpFunctions = await mcpFunctionAdapter.getAllMCPFunctions();
            console.log(`✅ [MCP REFRESH] Refreshed MCP functions: ${Object.keys(mcpFunctions).length} available`);
            console.log(`📋 [MCP FUNCTIONS] Updated function list: [${Object.keys(mcpFunctions).join(', ')}]`);
          } catch (error) {
            console.error('❌ [MCP REFRESH ERROR] Error refreshing MCP functions:', error);
          }
        });

        mcpManager.on('server-disconnected', async (serverId) => {
          try {
            console.log(`\n🔄 [MCP REFRESH] Server disconnected: ${serverId}`);
            mcpFunctions = await mcpFunctionAdapter.getAllMCPFunctions();
            console.log(`✅ [MCP REFRESH] Refreshed MCP functions after disconnection: ${Object.keys(mcpFunctions).length} available`);
            console.log(`📋 [MCP FUNCTIONS] Updated function list: [${Object.keys(mcpFunctions).join(', ')}]`);
          } catch (error) {
            console.error('❌ [MCP REFRESH ERROR] Error refreshing MCP functions:', error);
          }
        });
      }

      parentPort.postMessage({ type: 'ready' });

      // Send periodic status updates about queue and performance
      setInterval(() => {
        const status = requestQueue.getQueueStatus();
        if (status.chatQueue > 0 || status.analysisQueue > 0 || status.processing) {
          parentPort.postMessage({
            type: 'queue-status',
            status
          });
        }
      }, 2000); // Every 2 seconds

      // Handle different message types
      parentPort.on('message', async (message) => {
        const { type, id } = message;

        try {
          switch (type) {
            case 'chat':
            case undefined: // Backward compatibility for existing chat requests
              handleChatRequest(message, session, requestQueue);
              break;

            case 'analyze-transcript':
              handleAnalysisRequest(message, session, requestQueue);
              break;

            case 'shutdown':
              // Cleanup MCP connections (only if MCP enabled)
              if (mcpManager) {
                try {
                  await mcpManager.shutdown();
                } catch (error) {
                  console.error('Error shutting down MCP manager:', error);
                }
              }
              parentPort.postMessage({ id, type: 'shutdown-complete' });
              break;

            default:
              parentPort.postMessage({
                id,
                type: 'error',
                error: `Unknown message type: ${type}`
              });
          }
        } catch (err) {
          parentPort.postMessage({
            id,
            type: 'error',
            error: `Message handling error: ${err.toString()}`
          });
        }
      });

      // Handle worker termination
      process.on('SIGTERM', async () => {
        if (mcpManager) {
          try {
            await mcpManager.shutdown();
          } catch (error) {
            console.error('Error shutting down MCP manager on SIGTERM:', error);
          }
        }
        process.exit(0);
      });

      // Iterative function calling implementation
      async function handleIterativeFunctionCalling(session, initialPrompt, wrappedFunctions, mcpToolsUsed, hasTranscriptContext) {
        console.log(`\n🔄 [ITERATIVE FUNCTION CALLING] Starting iterative function calling`);
        console.log(`   Available functions: ${Object.keys(wrappedFunctions).length}`);
        console.log(`   Function names: [${Object.keys(wrappedFunctions).join(', ')}]`);
        console.log(`   Initial prompt length: ${initialPrompt.length} characters`);
        console.log(`   Has transcript context: ${hasTranscriptContext ? 'Yes' : 'No'}`);

        const sessionOptions = Object.keys(wrappedFunctions).length > 0
          ? { functions: wrappedFunctions }
          : {};

        let currentPrompt = initialPrompt;
        let iterationCount = 0;
        const maxIterations = 10; // Prevent infinite loops
        let totalSessionTime = 0;

        while (iterationCount < maxIterations) {
          iterationCount++;
          console.log(`\n🔄 [ITERATION ${iterationCount}] Starting iteration ${iterationCount}`);
          console.log(`   Prompt length: ${currentPrompt.length} characters`);

          const iterationStartTime = Date.now();
          
          try {
            const response = await session.prompt(currentPrompt, sessionOptions);
            const iterationDuration = Date.now() - iterationStartTime;
            totalSessionTime += iterationDuration;

            console.log(`✅ [ITERATION ${iterationCount}] Iteration completed`);
            console.log(`   Duration: ${iterationDuration}ms`);
            console.log(`   Response length: ${response.length} characters`);
            console.log(`   Response preview: ${response.substring(0, 300)}${response.length > 300 ? '...' : ''}`);

            // Check if the response contains function call results that need processing
            const hasFunctionCallResult = response.includes('[FUNCTION_CALL_RESULT]') || response.includes('[FUNCTION_CALL_ERROR]');
            
            if (!hasFunctionCallResult) {
              // No function calls in this iteration, we're done
              console.log(`🏁 [ITERATIVE COMPLETE] No function calls detected, finishing`);
              console.log(`   Total iterations: ${iterationCount}`);
              console.log(`   Total session time: ${totalSessionTime}ms`);
              console.log(`   MCP tools used: ${mcpToolsUsed.length}`);
              
              if (mcpToolsUsed.length > 0) {
                console.log(`\n📊 [MCP USAGE SUMMARY] Tools used in this session:`);
                mcpToolsUsed.forEach((tool, index) => {
                  console.log(`   ${index + 1}. ${tool.name} (${tool.serverId}) - ${tool.success ? 'SUCCESS' : 'FAILED'} - ${tool.duration}ms`);
                  if (!tool.success) {
                    console.log(`      Error: ${tool.error}`);
                  }
                });
              }
              
              return response;
            }

            // Function calls were made, check for errors and continue
            console.log(`🔧 [ITERATION ${iterationCount}] Function calls detected, checking for errors`);
            
            // Check for JSON syntax errors or other issues
            const hasJsonError = response.includes('SyntaxError') || 
                                response.includes('not valid JSON') || 
                                response.includes('Unexpected token');
            
            if (hasJsonError) {
              console.log(`❌ [ITERATION ${iterationCount}] JSON syntax error detected`);
              
              // Extract the error details
              const errorMatch = response.match(/SyntaxError: (.+?)(?:\n|$)/);
              const errorDetails = errorMatch ? errorMatch[1] : 'JSON parsing error';
              
              // Provide detailed feedback to help the model fix the issue
              currentPrompt = `❌ JSON SYNTAX ERROR: Your function call had malformed JSON.

Error: "${errorDetails}"

**YOU MUST TRY AGAIN** - Do not give up on using functions!

**Most common JSON errors and fixes**:

1. **Missing parameter values** (most common):
   - ❌ WRONG: {"query": "search term", "freshness": }
   - ✅ RIGHT: {"query": "search term", "freshness": "pw"}
   - ✅ BETTER: {"query": "search term"} (omit optional params)

2. **Missing quotes around strings**:
   - ❌ WRONG: {"query": search term}
   - ✅ RIGHT: {"query": "search term"}

3. **Trailing commas**:
   - ❌ WRONG: {"query": "search term",}
   - ✅ RIGHT: {"query": "search term"}

4. **Extra closing brackets**:
   - ❌ WRONG: {"query": "search term"}}
   - ✅ RIGHT: {"query": "search term"}

**REQUIRED ACTION**: You must now call the function again with correct JSON syntax. Use only the required parameters to avoid errors:

For mcp_brave-search_brave_web_search, use:
{
  "query": "your search term"
}

Try the function call again now with proper JSON formatting.`;
            } else {
              // Function calls succeeded, continue the conversation
              console.log(`✅ [ITERATION ${iterationCount}] Function calls successful, continuing conversation`);
              currentPrompt = "Please continue your response based on the function call results above.";
            }

          } catch (error) {
            console.log(`❌ [ITERATION ${iterationCount}] Iteration failed`);
            console.log(`   Error: ${error.message}`);
            console.log(`   Error type: ${error.constructor.name}`);
            
            // Check if this is a JSON parsing error from function calling
            if (error.message.includes('not valid JSON') || error.message.includes('Unexpected token')) {
              console.log(`🔍 [JSON ERROR ANALYSIS] Detected JSON parsing error in function call`);
              
              // Extract more details about the JSON error
              const jsonErrorMatch = error.message.match(/Unexpected token '(.)', "(.+?)" is not valid JSON/);
              if (jsonErrorMatch) {
                const [, unexpectedChar, jsonFragment] = jsonErrorMatch;
                console.log(`   Unexpected character: '${unexpectedChar}'`);
                console.log(`   JSON fragment: "${jsonFragment}"`);
              }
              
              // Provide specific guidance for JSON function call errors
              currentPrompt = `❌ FUNCTION CALL ERROR: Your previous function call had invalid JSON syntax.

Error: "${error.message}"

You MUST fix this and try the function call again. Do NOT give up on using functions.

**REQUIRED ACTION**: Call the mcp_brave-search_brave_web_search function again with correct JSON syntax.

**Correct format for brave_web_search**:
{
  "query": "your search term here"
}

**Common mistakes to avoid**:
- ❌ Missing quotes: {"query": search term}
- ❌ Missing values: {"query": "search term", "freshness": }
- ❌ Extra brackets: {"query": "search term"}}
- ❌ Trailing commas: {"query": "search term",}

**✅ CORRECT EXAMPLE**:
{
  "query": "JavaScript tutorials"
}

Now please call the function again with the correct JSON syntax. You must use the function - do not skip it.`;
            } else {
              // Other types of errors
              console.log(`   Stack trace:`, error.stack);
              currentPrompt = `An error occurred during the previous iteration: ${error.message}. Please try a different approach or continue without function calls.`;
            }
          }
        }

        // Max iterations reached
        console.log(`⚠️ [ITERATIVE TIMEOUT] Maximum iterations (${maxIterations}) reached`);
        console.log(`   Total session time: ${totalSessionTime}ms`);
        console.log(`   MCP tools used: ${mcpToolsUsed.length}`);
        
        // Return a final response
        const finalResponse = await session.prompt("Please provide a final response based on the information gathered so far.", {});
        return finalResponse;
      }

      // Handle chat requests (existing functionality with transcript context and function calling)
      function handleChatRequest(message, session, requestQueue) {
        const { id, prompt, transcriptContext } = message;

        requestQueue.addChatRequest({
          handler: async () => {
            try {
              // Build context-aware prompt that includes recent transcript
              let contextualPrompt = prompt;

              if (transcriptContext && transcriptContext.trim().length > 0) {
                contextualPrompt = `Recent conversation context:
${transcriptContext}

User question: ${prompt}

Please respond considering the conversation context above.`;
              }

              // Track MCP tool calls for this request
              const mcpToolsUsed = [];

              // Combine local functions (if any) with MCP functions
              const allFunctions = {
                ...mcpFunctions // MCP functions are already available
                // Add local functions here when they exist
              };

              // Wrap MCP functions to track usage and handle results properly
              const wrappedFunctions = {};
              for (const [funcName, funcDef] of Object.entries(allFunctions)) {
                if (funcName.startsWith('mcp_')) {
                  wrappedFunctions[funcName] = {
                    ...funcDef,
                    handler: async (params) => {
                      const toolInfo = {
                        name: funcName.replace(/^mcp_[^_]+_/, ''), // Remove mcp_serverId_ prefix
                        serverId: funcName.split('_')[1], // Extract server ID
                        parameters: params,
                        timestamp: new Date().toISOString()
                      };

                      console.log(`\n🔧 [MCP FUNCTION CALL] Starting function call`);
                      console.log(`   Function: ${funcName}`);
                      console.log(`   Tool: ${toolInfo.name}`);
                      console.log(`   Server: ${toolInfo.serverId}`);
                      console.log(`   Parameters:`, JSON.stringify(params, null, 2));
                      console.log(`   Timestamp: ${toolInfo.timestamp}`);

                      try {
                        const callStartTime = Date.now();
                        const result = await funcDef.handler(params);
                        const callDuration = Date.now() - callStartTime;

                        toolInfo.result = result;
                        toolInfo.success = true;
                        toolInfo.duration = callDuration;
                        mcpToolsUsed.push(toolInfo);

                        console.log(`✅ [MCP FUNCTION SUCCESS] Function completed successfully`);
                        console.log(`   Function: ${funcName}`);
                        console.log(`   Duration: ${callDuration}ms`);
                        console.log(`   Result length: ${typeof result === 'string' ? result.length : JSON.stringify(result).length} characters`);
                        console.log(`   Result preview: ${typeof result === 'string' ? result.substring(0, 200) : JSON.stringify(result).substring(0, 200)}${(typeof result === 'string' ? result.length : JSON.stringify(result).length) > 200 ? '...' : ''}`);

                        // Create JSON response that clearly indicates it's from a function call
                        const functionResponse = {
                          _source: "FUNCTION_CALL_RESULT",
                          _function: funcName,
                          _tool: toolInfo.name,
                          _server: toolInfo.serverId,
                          _timestamp: toolInfo.timestamp,
                          _duration_ms: callDuration,
                          tool: funcName,
                          result: result,
                          success: true
                        };

                        const jsonResponse = `[FUNCTION_CALL_RESULT] ${JSON.stringify(functionResponse, null, 2)}`;
                        console.log(`📤 [MCP FUNCTION RESPONSE] Sending JSON response to model:`);
                        console.log(`   Response size: ${jsonResponse.length} characters`);
                        console.log(`   JSON Response:`, jsonResponse);

                        return jsonResponse;
                      } catch (error) {
                        const callDuration = Date.now() - (toolInfo.callStartTime || Date.now());

                        toolInfo.error = error.message;
                        toolInfo.success = false;
                        toolInfo.duration = callDuration;
                        mcpToolsUsed.push(toolInfo);

                        console.log(`❌ [MCP FUNCTION ERROR] Function call failed`);
                        console.log(`   Function: ${funcName}`);
                        console.log(`   Duration: ${callDuration}ms`);
                        console.log(`   Error: ${error.message}`);
                        console.log(`   Stack trace:`, error.stack);

                        // Create detailed JSON error response
                        let detailedError = error.message;
                        let errorType = 'UNKNOWN_ERROR';
                        let suggestions = [];

                        // Categorize and provide suggestions for common errors
                        if (error.message.includes('Missing required parameter')) {
                          errorType = 'MISSING_PARAMETER';
                          const paramMatch = error.message.match(/Missing required parameter: (\w+)/);
                          if (paramMatch) {
                            suggestions.push(`Please provide the required parameter: ${paramMatch[1]}`);
                            suggestions.push(`Check the function documentation for parameter requirements`);
                          }
                        } else if (error.message.includes('Invalid arguments')) {
                          errorType = 'INVALID_ARGUMENTS';
                          suggestions.push('Check that all parameters are correctly formatted');
                          suggestions.push('Ensure parameter types match the expected schema');
                        } else if (error.message.includes('not valid JSON')) {
                          errorType = 'JSON_SYNTAX_ERROR';
                          suggestions.push('Check for proper JSON syntax: quotes, commas, brackets');
                          suggestions.push('Ensure all property names are in double quotes');
                          suggestions.push('Remove any trailing commas');
                        } else if (error.message.includes('timeout')) {
                          errorType = 'TIMEOUT_ERROR';
                          suggestions.push('The operation took too long to complete');
                          suggestions.push('Try with simpler parameters or retry the request');
                        } else if (error.message.includes('connection') || error.message.includes('network')) {
                          errorType = 'CONNECTION_ERROR';
                          suggestions.push('There was a network connectivity issue');
                          suggestions.push('The MCP server may be temporarily unavailable');
                        }

                        const errorResponse = {
                          _source: "FUNCTION_CALL_ERROR",
                          _function: funcName,
                          _tool: toolInfo.name,
                          _server: toolInfo.serverId,
                          _timestamp: toolInfo.timestamp,
                          _duration_ms: callDuration,
                          _error_type: errorType,
                          tool: funcName,
                          error: detailedError,
                          error_details: {
                            type: errorType,
                            message: error.message,
                            suggestions: suggestions,
                            stack: error.stack ? error.stack.split('\n').slice(0, 3) : []
                          },
                          success: false
                        };

                        const jsonResponse = `[FUNCTION_CALL_ERROR] ${JSON.stringify(errorResponse, null, 2)}`;
                        console.log(`📤 [MCP FUNCTION ERROR RESPONSE] Sending detailed JSON error response to model:`);
                        console.log(`   Response size: ${jsonResponse.length} characters`);
                        console.log(`   Error type: ${errorType}`);
                        console.log(`   Suggestions: ${suggestions.join(', ')}`);
                        console.log(`   JSON Response:`, jsonResponse);

                        return jsonResponse;
                      }
                    }
                  };
                } else {
                  wrappedFunctions[funcName] = funcDef;
                }
              }

              // Use iterative function calling approach
              const response = await handleIterativeFunctionCalling(
                session, 
                contextualPrompt, 
                wrappedFunctions, 
                mcpToolsUsed,
                transcriptContext && transcriptContext.trim().length > 0
              );

              // Include MCP tool information in response
              parentPort.postMessage({
                id,
                response,
                mcpToolsUsed: mcpToolsUsed.length > 0 ? mcpToolsUsed : undefined
              });
            } catch (err) {
              parentPort.postMessage({ id, error: err.toString() });
            }
          }
        });
      }

      // Handle analysis requests (new functionality with performance optimizations)
      function handleAnalysisRequest(message, session, requestQueue) {
        const { id, transcript, context, analysisType, timeRange } = message;

        // Validate input
        if (!transcript || transcript.trim().length === 0) {
          parentPort.postMessage({
            id,
            type: 'analysis-error',
            error: 'Empty or invalid transcript provided'
          });
          return;
        }

        // Skip analysis if transcript is too short to be meaningful
        if (transcript.trim().length < 50) {
          parentPort.postMessage({
            id,
            type: 'analysis-response',
            results: {
              summary: 'Transcript too short for meaningful analysis',
              suggestions: { actionItems: [], questions: [], topics: [] }
            },
            timeRange
          });
          return;
        }

        requestQueue.addAnalysisRequest({
          handler: async () => {
            try {
              // Send progress indicator for long-running analysis
              parentPort.postMessage({
                id,
                type: 'analysis-progress',
                message: 'Starting transcript analysis...'
              });

              const results = {};
              const startTime = Date.now();

              // Truncate very long transcripts to prevent overwhelming local LLM
              const maxTranscriptLength = 2000;
              const truncatedTranscript = transcript.length > maxTranscriptLength
                ? transcript.substring(transcript.length - maxTranscriptLength)
                : transcript;

              // Generate summary if requested
              if (!analysisType || analysisType.includes('summary')) {
                try {
                  parentPort.postMessage({
                    id,
                    type: 'analysis-progress',
                    message: 'Generating summary...'
                  });

                  const summaryPrompt = ANALYSIS_PROMPTS.summary(truncatedTranscript, context, timeRange);

                  // Use functions for analysis if available
                  const allFunctions = { ...mcpFunctions };
                  const sessionOptions = Object.keys(allFunctions).length > 0
                    ? { functions: allFunctions }
                    : {};

                  const summaryResponse = await session.prompt(summaryPrompt, sessionOptions);
                  results.summary = summaryResponse.trim();
                } catch (err) {
                  console.error('Summary generation error:', err);
                  results.summaryError = `Summary generation failed: ${err.toString()}`;
                  // Provide fallback summary
                  results.summary = `Analysis unavailable. Recent discussion: ${truncatedTranscript.substring(0, 100)}...`;
                }
              }

              // Generate suggestions if requested (only if summary succeeded or wasn't requested)
              if ((!analysisType || analysisType.includes('suggestions')) && !results.summaryError) {
                try {
                  parentPort.postMessage({
                    id,
                    type: 'analysis-progress',
                    message: 'Generating suggestions...'
                  });

                  const suggestionsPrompt = ANALYSIS_PROMPTS.suggestions(truncatedTranscript, context);

                  // Use functions for suggestions analysis if available
                  const allFunctions = { ...mcpFunctions };
                  const sessionOptions = Object.keys(allFunctions).length > 0
                    ? { functions: allFunctions }
                    : {};

                  const suggestionsResponse = await session.prompt(suggestionsPrompt, sessionOptions);

                  // Try to parse JSON response with better error handling
                  try {
                    const cleanResponse = suggestionsResponse.trim();
                    // Extract JSON if it's wrapped in markdown code blocks
                    const jsonMatch = cleanResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) ||
                      cleanResponse.match(/(\{[\s\S]*\})/);

                    if (jsonMatch) {
                      results.suggestions = JSON.parse(jsonMatch[1]);
                    } else {
                      throw new Error('No JSON found in response');
                    }
                  } catch (parseErr) {
                    console.error('JSON parsing error:', parseErr);
                    // Provide structured fallback
                    results.suggestions = {
                      actionItems: [],
                      questions: [],
                      topics: [],
                      raw: suggestionsResponse.trim(),
                      parseError: parseErr.toString()
                    };
                  }
                } catch (err) {
                  console.error('Suggestions generation error:', err);
                  results.suggestionsError = `Suggestions generation failed: ${err.toString()}`;
                  // Provide empty structured response
                  results.suggestions = {
                    actionItems: [],
                    questions: [],
                    topics: []
                  };
                }
              } else if (results.summaryError) {
                // Skip suggestions if summary failed to avoid overloading LLM
                results.suggestions = {
                  actionItems: [],
                  questions: [],
                  topics: []
                };
              }

              // Generate activities if requested
              if (!analysisType || analysisType.includes('activities')) {
                try {
                  parentPort.postMessage({
                    id,
                    type: 'analysis-progress',
                    message: 'Generating activities...'
                  });

                  const activitiesPrompt = ANALYSIS_PROMPTS.activities(truncatedTranscript, context);

                  // Use functions for activities analysis if available
                  const allFunctions = { ...mcpFunctions };
                  const sessionOptions = Object.keys(allFunctions).length > 0
                    ? { functions: allFunctions }
                    : {};

                  const activitiesResponse = await session.prompt(activitiesPrompt, sessionOptions);

                  // Parse bulleted list into an array of strings
                  results.activities = activitiesResponse.split(/\n\s*[-*+]\s*/).filter(line => line.trim() !== '');
                } catch (err) {
                  console.error('Activities generation error:', err);
                  results.activitiesError = `Activities generation failed: ${err.toString()}`;
                  results.activities = []; // Provide empty array on error
                }
              }

              const processingTime = Date.now() - startTime;

              parentPort.postMessage({
                id,
                type: 'analysis-response',
                results,
                timeRange,
                processingTime,
                queueStatus: requestQueue.getQueueStatus()
              });

            } catch (err) {
              console.error('Analysis handler error:', err);
              parentPort.postMessage({
                id,
                type: 'analysis-error',
                error: `Analysis failed: ${err.toString()}`,
                queueStatus: requestQueue.getQueueStatus()
              });
            }
          }
        });
      }

    } catch (err) {
      parentPort.postMessage({
        type: 'error',
        error: `Failed to load model: ${err.toString()}. Make sure the model file exists at ${modelPath}`
      });
    }
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: err.toString() });
  }
})();
