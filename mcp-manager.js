const { spawn } = require('child_process');
const EventEmitter = require('events');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

/**
 * MCP Manager
 * Manages multiple MCP client connections and provides unified access to tools and resources
 */
class MCPManager extends EventEmitter {
  constructor(configManager) {
    super();
    this.configManager = configManager;
    this.clients = new Map(); // serverId -> { client, transport, process, tools, resources }
    this.isInitialized = false;
    
    // Listen for configuration changes
    this.configManager.on('config-changed', () => {
      this.handleConfigChange();
    });
  }

  /**
   * Initialize the MCP Manager
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.configManager.loadConfig();
      await this.connectToServers();
      this.isInitialized = true;
      console.log('MCP Manager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize MCP Manager:', error);
      throw error;
    }
  }

  /**
   * Connect to all enabled MCP servers
   */
  async connectToServers() {
    const enabledServers = this.configManager.getEnabledServers();
    
    for (const [serverId, serverConfig] of Object.entries(enabledServers)) {
      try {
        await this.connectToServer(serverId, serverConfig);
      } catch (error) {
        console.error(`Failed to connect to MCP server ${serverId}:`, error);
        this.configManager.updateServerStatus(serverId, {
          connected: false,
          lastError: error.message,
          lastAttempt: new Date().toISOString()
        });
      }
    }
  }

  /**
   * Connect to a specific MCP server
   * @param {string} serverId - Server identifier
   * @param {Object} serverConfig - Server configuration
   */
  async connectToServer(serverId, serverConfig) {
    // Disconnect existing connection if any
    if (this.clients.has(serverId)) {
      await this.disconnectFromServer(serverId);
    }

    console.log(`Connecting to MCP server: ${serverId}`);

    try {
      // Create transport using the SDK's built-in stdio transport
      const transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args || [],
        env: { ...process.env, ...serverConfig.env }
      });

      const client = new Client(
        {
          name: "insighto",
          version: "1.0.0"
        },
        {
          capabilities: {
            tools: {},
            resources: {}
          }
        }
      );

      // Connect the client
      await client.connect(transport);

      // Get the underlying process for monitoring
      const serverProcess = transport.process;

      // Handle process events if available
      if (serverProcess) {
        serverProcess.on('error', (error) => {
          console.error(`MCP server process error for ${serverId}:`, error);
          this.handleServerError(serverId, error);
        });

        serverProcess.on('exit', (code, signal) => {
          console.log(`MCP server ${serverId} exited with code ${code}, signal ${signal}`);
          this.handleServerDisconnection(serverId);
        });
      }

      // Discover available tools and resources
      const tools = await this.discoverTools(client);
      const resources = await this.discoverResources(client);

      // Store client information
      this.clients.set(serverId, {
        client,
        transport,
        process: serverProcess,
        tools,
        resources,
        config: serverConfig
      });

      // Update server status
      this.configManager.updateServerStatus(serverId, {
        connected: true,
        lastConnected: new Date().toISOString(),
        lastError: null,
        toolCount: tools.length,
        resourceCount: resources.length
      });

      console.log(`Successfully connected to MCP server ${serverId} with ${tools.length} tools and ${resources.length} resources`);
      this.emit('server-connected', serverId, { tools, resources });

    } catch (error) {
      console.error(`Failed to connect to MCP server ${serverId}:`, error);
      this.configManager.updateServerStatus(serverId, {
        connected: false,
        lastError: error.message,
        lastAttempt: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Discover tools from an MCP client
   * @param {Client} client - MCP client instance
   * @returns {Array} Array of tool definitions
   */
  async discoverTools(client) {
    try {
      console.log('Discovering tools...');
      const response = await client.listTools();
      console.log('Tools response:', response);
      return response.tools || [];
    } catch (error) {
      console.error('Failed to discover tools:', error);
      return [];
    }
  }

  /**
   * Discover resources from an MCP client
   * @param {Client} client - MCP client instance
   * @returns {Array} Array of resource definitions
   */
  async discoverResources(client) {
    try {
      console.log('Discovering resources...');
      const response = await client.listResources();
      console.log('Resources response:', response);
      return response.resources || [];
    } catch (error) {
      console.error('Failed to discover resources:', error);
      return [];
    }
  }

  /**
   * Disconnect from a specific server
   * @param {string} serverId - Server identifier
   */
  async disconnectFromServer(serverId) {
    const clientInfo = this.clients.get(serverId);
    if (!clientInfo) {
      return;
    }

    try {
      // Close the client connection
      if (clientInfo.client) {
        await clientInfo.client.close();
      }

      // Kill the server process
      if (clientInfo.process && !clientInfo.process.killed) {
        clientInfo.process.kill('SIGTERM');
        
        // Force kill after timeout
        setTimeout(() => {
          if (!clientInfo.process.killed) {
            clientInfo.process.kill('SIGKILL');
          }
        }, 5000);
      }

      this.clients.delete(serverId);
      
      this.configManager.updateServerStatus(serverId, {
        connected: false,
        lastDisconnected: new Date().toISOString()
      });

      console.log(`Disconnected from MCP server: ${serverId}`);
      this.emit('server-disconnected', serverId);

    } catch (error) {
      console.error(`Error disconnecting from server ${serverId}:`, error);
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectFromServers() {
    const disconnectPromises = Array.from(this.clients.keys()).map(serverId => 
      this.disconnectFromServer(serverId)
    );
    
    await Promise.all(disconnectPromises);
  }

  /**
   * Reconnect to a specific server
   * @param {string} serverId - Server identifier
   */
  async reconnectServer(serverId) {
    const config = this.configManager.getConfig();
    const serverConfig = config?.mcpServers?.[serverId];
    
    if (!serverConfig || serverConfig.disabled) {
      throw new Error(`Server ${serverId} is not configured or is disabled`);
    }

    await this.connectToServer(serverId, serverConfig);
  }

  /**
   * Get all available tools from all connected servers
   * @returns {Array} Array of all tools with server metadata
   */
  async getAllTools() {
    const allTools = [];
    
    for (const [serverId, clientInfo] of this.clients.entries()) {
      if (clientInfo.tools) {
        const toolsWithMetadata = clientInfo.tools.map(tool => ({
          ...tool,
          serverId,
          source: 'mcp'
        }));
        allTools.push(...toolsWithMetadata);
      }
    }
    
    return allTools;
  }

  /**
   * Get all available resources from all connected servers
   * @returns {Array} Array of all resources with server metadata
   */
  async getAllResources() {
    const allResources = [];
    
    for (const [serverId, clientInfo] of this.clients.entries()) {
      if (clientInfo.resources) {
        const resourcesWithMetadata = clientInfo.resources.map(resource => ({
          ...resource,
          serverId,
          source: 'mcp'
        }));
        allResources.push(...resourcesWithMetadata);
      }
    }
    
    return allResources;
  }

  /**
   * Call a tool on the appropriate MCP server
   * @param {string} toolName - Name of the tool to call
   * @param {Object} parameters - Parameters to pass to the tool
   * @returns {Promise<Object>} Tool execution result
   */
  async callTool(toolName, parameters = {}) {
    // Find which server has this tool
    let targetServer = null;
    let targetTool = null;

    for (const [serverId, clientInfo] of this.clients.entries()) {
      const tool = clientInfo.tools?.find(t => t.name === toolName);
      if (tool) {
        targetServer = serverId;
        targetTool = tool;
        break;
      }
    }

    if (!targetServer || !targetTool) {
      throw new Error(`Tool '${toolName}' not found in any connected MCP server`);
    }

    const clientInfo = this.clients.get(targetServer);
    if (!clientInfo || !clientInfo.client) {
      throw new Error(`MCP server '${targetServer}' is not connected`);
    }

    try {
      console.log(`Calling MCP tool '${toolName}' on server '${targetServer}' with parameters:`, parameters);
      
      const result = await clientInfo.client.callTool({
        name: toolName,
        arguments: parameters
      });

      this.emit('tool-called', {
        serverId: targetServer,
        toolName,
        parameters,
        result,
        success: true
      });

      return result;

    } catch (error) {
      console.error(`Error calling tool '${toolName}' on server '${targetServer}':`, error);
      
      this.emit('tool-called', {
        serverId: targetServer,
        toolName,
        parameters,
        error: error.message,
        success: false
      });

      throw error;
    }
  }

  /**
   * Get connection status for all servers
   * @returns {Object} Status information for all servers
   */
  getConnectionStatus() {
    const status = {};
    
    for (const [serverId, clientInfo] of this.clients.entries()) {
      status[serverId] = {
        connected: true,
        toolCount: clientInfo.tools?.length || 0,
        resourceCount: clientInfo.resources?.length || 0,
        processId: clientInfo.process?.pid
      };
    }

    // Add disconnected servers from config
    const config = this.configManager.getConfig();
    if (config?.mcpServers) {
      for (const serverId of Object.keys(config.mcpServers)) {
        if (!status[serverId]) {
          status[serverId] = {
            connected: false,
            toolCount: 0,
            resourceCount: 0
          };
        }
      }
    }

    return status;
  }

  /**
   * Handle server errors
   * @param {string} serverId - Server identifier
   * @param {Error} error - Error that occurred
   */
  handleServerError(serverId, error) {
    console.error(`MCP server ${serverId} error:`, error);
    
    this.configManager.updateServerStatus(serverId, {
      connected: false,
      lastError: error.message,
      lastErrorTime: new Date().toISOString()
    });

    this.emit('server-error', serverId, error);
  }

  /**
   * Handle server disconnection
   * @param {string} serverId - Server identifier
   */
  handleServerDisconnection(serverId) {
    if (this.clients.has(serverId)) {
      this.clients.delete(serverId);
      
      this.configManager.updateServerStatus(serverId, {
        connected: false,
        lastDisconnected: new Date().toISOString()
      });

      this.emit('server-disconnected', serverId);
    }
  }

  /**
   * Handle configuration changes
   */
  async handleConfigChange() {
    console.log('MCP configuration changed, updating connections...');
    
    try {
      // Disconnect from servers that are no longer enabled
      const enabledServers = this.configManager.getEnabledServers();
      const enabledServerIds = new Set(Object.keys(enabledServers));
      
      for (const serverId of this.clients.keys()) {
        if (!enabledServerIds.has(serverId)) {
          await this.disconnectFromServer(serverId);
        }
      }

      // Connect to newly enabled servers
      for (const [serverId, serverConfig] of Object.entries(enabledServers)) {
        if (!this.clients.has(serverId)) {
          try {
            await this.connectToServer(serverId, serverConfig);
          } catch (error) {
            console.error(`Failed to connect to newly enabled server ${serverId}:`, error);
          }
        }
      }

    } catch (error) {
      console.error('Error handling configuration change:', error);
    }
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown() {
    console.log('Shutting down MCP Manager...');
    await this.disconnectFromServers();
    this.isInitialized = false;
  }
}

module.exports = MCPManager;