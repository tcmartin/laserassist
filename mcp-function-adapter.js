const EventEmitter = require('events');

/**
 * MCP Function Adapter
 * Converts MCP tools to node-llama-cpp function format and handles execution
 */
class MCPFunctionAdapter extends EventEmitter {
  constructor(mcpManager) {
    super();
    this.mcpManager = mcpManager;
  }

  /**
   * Convert MCP tools to node-llama-cpp function format
   * @param {Array} mcpTools - Array of MCP tool definitions
   * @returns {Object} Functions object compatible with node-llama-cpp
   */
  static convertMCPToolsToFunctions(mcpTools, mcpManager) {
    const functions = {};

    for (const tool of mcpTools) {
      // Create function name with mcp_ prefix to distinguish from local functions
      const functionName = `mcp_${tool.serverId}_${tool.name}`;
      
      // Use the correct node-llama-cpp function format
      functions[functionName] = {
        description: tool.description || `MCP tool: ${tool.name}`,
        params: tool.inputSchema || {
          type: "object",
          properties: {},
          required: []
        },
        handler: MCPFunctionAdapter.createFunctionHandler(mcpManager, tool.name, tool.serverId, tool.inputSchema)
      };
    }

    return functions;
  }

  /**
   * Create a function handler for an MCP tool
   * @param {MCPManager} mcpManager - MCP Manager instance
   * @param {string} toolName - Name of the MCP tool
   * @param {string} serverId - ID of the server hosting the tool
   * @returns {Function} Handler function for the tool
   */
  static createFunctionHandler(mcpManager, toolName, serverId, inputSchema) {
    return async (parameters) => {
      try {
        console.log(`Calling MCP tool ${toolName} on server ${serverId} with parameters:`, parameters);
        
        // Validate parameters with schema
        const validatedParams = MCPFunctionAdapter.validateParameters(parameters, inputSchema);
        
        // Call the MCP tool
        const result = await mcpManager.callTool(toolName, validatedParams);
        
        // Format the response for LLM consumption
        return MCPFunctionAdapter.formatResponse(result, toolName);
        
      } catch (error) {
        console.error(`Error calling MCP tool ${toolName}:`, error);
        return MCPFunctionAdapter.handleError(error, toolName, serverId);
      }
    };
  }

  /**
   * Validate parameters before sending to MCP server
   * @param {Object} parameters - Parameters to validate
   * @param {Object} inputSchema - Tool's input schema for validation
   * @returns {Object} Validated parameters
   */
  static validateParameters(parameters, inputSchema) {
    // Basic parameter validation and sanitization
    if (!parameters || typeof parameters !== 'object') {
      parameters = {};
    }

    // Remove any undefined values
    const cleanParams = {};
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null) {
        cleanParams[key] = value;
      }
    }

    // Check for required parameters and provide helpful error messages
    if (inputSchema && inputSchema.required && Array.isArray(inputSchema.required)) {
      for (const requiredParam of inputSchema.required) {
        if (!(requiredParam in cleanParams) || cleanParams[requiredParam] === '') {
          throw new Error(`Missing required parameter: ${requiredParam}. Please provide a value for ${requiredParam}.`);
        }
      }
    }

    return cleanParams;
  }

  /**
   * Format MCP response for LLM consumption
   * @param {Object} mcpResponse - Response from MCP server
   * @param {string} toolName - Name of the tool that was called
   * @returns {string} Formatted response
   */
  static formatResponse(mcpResponse, toolName) {
    try {
      // Handle different MCP response formats
      if (mcpResponse.content) {
        // Standard MCP response with content array
        if (Array.isArray(mcpResponse.content)) {
          return mcpResponse.content
            .map(item => {
              if (item.type === 'text') {
                return item.text;
              } else if (item.type === 'image') {
                return `[Image: ${item.data || 'image data'}]`;
              } else {
                return JSON.stringify(item);
              }
            })
            .join('\n');
        } else {
          return String(mcpResponse.content);
        }
      } else if (mcpResponse.result) {
        // Some MCP servers return result directly
        return typeof mcpResponse.result === 'string' 
          ? mcpResponse.result 
          : JSON.stringify(mcpResponse.result, null, 2);
      } else if (typeof mcpResponse === 'string') {
        // Direct string response
        return mcpResponse;
      } else {
        // Fallback: stringify the entire response
        return JSON.stringify(mcpResponse, null, 2);
      }
    } catch (error) {
      console.error(`Error formatting response from ${toolName}:`, error);
      return `Tool ${toolName} completed but response formatting failed: ${error.message}`;
    }
  }

  /**
   * Handle errors from MCP tool calls
   * @param {Error} error - Error that occurred
   * @param {string} toolName - Name of the tool that failed
   * @param {string} serverId - ID of the server
   * @returns {string} Error message for LLM
   */
  static handleError(error, toolName, serverId) {
    const errorMessage = error.message || 'Unknown error';
    
    // Categorize error types for better handling
    if (errorMessage.includes('not found')) {
      return `Tool "${toolName}" is not available on server "${serverId}". The tool may have been removed or the server may be disconnected.`;
    } else if (errorMessage.includes('timeout')) {
      return `Tool "${toolName}" timed out. The operation may be taking longer than expected or the server may be unresponsive.`;
    } else if (errorMessage.includes('Missing required parameter')) {
      return `Tool "${toolName}" failed: ${errorMessage}. Please call the function again with the required parameters.`;
    } else if (errorMessage.includes('parameter') || errorMessage.includes('Invalid arguments')) {
      return `Tool "${toolName}" failed due to invalid parameters: ${errorMessage}. Please check the required parameters and try again.`;
    } else if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
      return `Tool "${toolName}" failed due to permission issues: ${errorMessage}`;
    } else {
      return `Tool "${toolName}" failed: ${errorMessage}`;
    }
  }

  /**
   * Get all available MCP functions
   * @returns {Promise<Object>} Functions object for node-llama-cpp
   */
  async getAllMCPFunctions() {
    try {
      const mcpTools = await this.mcpManager.getAllTools();
      return MCPFunctionAdapter.convertMCPToolsToFunctions(mcpTools, this.mcpManager);
    } catch (error) {
      console.error('Error getting MCP functions:', error);
      return {};
    }
  }

  /**
   * Refresh MCP functions (useful when servers connect/disconnect)
   * @returns {Promise<Object>} Updated functions object
   */
  async refreshMCPFunctions() {
    return this.getAllMCPFunctions();
  }
}

module.exports = MCPFunctionAdapter;