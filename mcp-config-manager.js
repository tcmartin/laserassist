const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

/**
 * MCP Configuration Manager
 * Handles loading, saving, and validating MCP server configurations
 */
class MCPConfigManager extends EventEmitter {
  constructor(configPath = '.insighto/settings/mcp.json') {
    super();
    this.configPath = configPath;
    this.config = null;
  }

  /**
   * Load MCP configuration from file
   * @returns {Promise<Object>} The loaded configuration
   */
  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      
      // Ensure config has required structure
      if (!this.config.mcpServers) {
        this.config.mcpServers = {};
      }
      
      return this.config;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Config file doesn't exist, create default
        this.config = {
          mcpServers: {}
        };
        await this.saveConfig(this.config);
        return this.config;
      }
      throw new Error(`Failed to load MCP configuration: ${error.message}`);
    }
  }

  /**
   * Save MCP configuration to file
   * @param {Object} config - Configuration to save
   */
  async saveConfig(config) {
    try {
      // Ensure directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // Save configuration
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
      this.config = config;
      
      this.emit('config-changed', config);
    } catch (error) {
      throw new Error(`Failed to save MCP configuration: ${error.message}`);
    }
  }

  /**
   * Validate server configuration
   * @param {Object} serverConfig - Server configuration to validate
   * @returns {Object} Validation result with success and errors
   */
  validateServerConfig(serverConfig) {
    const errors = [];

    // Required fields
    if (!serverConfig.command) {
      errors.push('Command is required');
    }

    if (!Array.isArray(serverConfig.args)) {
      errors.push('Args must be an array');
    }

    // Optional fields validation
    if (serverConfig.env && typeof serverConfig.env !== 'object') {
      errors.push('Environment variables must be an object');
    }

    if (serverConfig.disabled !== undefined && typeof serverConfig.disabled !== 'boolean') {
      errors.push('Disabled must be a boolean');
    }

    if (serverConfig.autoApprove && !Array.isArray(serverConfig.autoApprove)) {
      errors.push('AutoApprove must be an array');
    }

    return {
      success: errors.length === 0,
      errors
    };
  }

  /**
   * Get all enabled servers
   * @returns {Object} Enabled servers configuration
   */
  getEnabledServers() {
    if (!this.config || !this.config.mcpServers) {
      return {};
    }

    const enabledServers = {};
    for (const [serverId, serverConfig] of Object.entries(this.config.mcpServers)) {
      if (!serverConfig.disabled) {
        enabledServers[serverId] = serverConfig;
      }
    }

    return enabledServers;
  }

  /**
   * Update server status
   * @param {string} serverId - Server ID
   * @param {Object} status - Status update
   */
  updateServerStatus(serverId, status) {
    if (!this.config || !this.config.mcpServers || !this.config.mcpServers[serverId]) {
      return;
    }

    if (!this.config.mcpServers[serverId].status) {
      this.config.mcpServers[serverId].status = {};
    }

    Object.assign(this.config.mcpServers[serverId].status, status);
    this.emit('server-status-changed', serverId, status);
  }

  /**
   * Get current configuration
   * @returns {Object} Current configuration
   */
  getConfig() {
    return this.config;
  }

  /**
   * Add or update a server configuration
   * @param {string} serverId - Server ID
   * @param {Object} serverConfig - Server configuration
   */
  async updateServer(serverId, serverConfig) {
    const validation = this.validateServerConfig(serverConfig);
    if (!validation.success) {
      throw new Error(`Invalid server configuration: ${validation.errors.join(', ')}`);
    }

    if (!this.config) {
      await this.loadConfig();
    }

    this.config.mcpServers[serverId] = serverConfig;
    await this.saveConfig(this.config);
  }

  /**
   * Remove a server configuration
   * @param {string} serverId - Server ID to remove
   */
  async removeServer(serverId) {
    if (!this.config || !this.config.mcpServers) {
      return;
    }

    delete this.config.mcpServers[serverId];
    await this.saveConfig(this.config);
  }
}

module.exports = MCPConfigManager;