/**
 * AI Agent Node Type - Enhanced with routing support
 * AI-powered processing node for Labs with MindWorkflow routing integration
 * @see ADR-043: Laboratories Feature
 */
import { BaseNode } from './base-node.js';
import { dbGet, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { executeAI, executeSimpleAI } from '../ai-execution-service.js';
import { logExecutionMetrics } from '../metrics-service.js';

export const AIAgentNode = {
  ...BaseNode,
  typeKey: 'ai_agent',
  name: 'AI Agent',
  description: 'AI-powered processing node',
  icon: '🤖',
  category: 'ai',
  
  defaultConfig: {
    ai_agent_id: null,
    prompt_template: '',
    temperature: 0.7,
    max_tokens: 1000,
    model: 'gpt-4o-mini',
    routing_config: {
      outputs: [
        {
          id: 'text',
          type: 'text',
          label: 'Text',
          contentType: 'text/plain',
          enabled: true,
          description: 'Plain text response'
        }
      ],
      defaultOutput: 'text',
      autoRouting: {
        enabled: false,
        rules: {
          detectJson: false,
          detectCode: false,
          detectMarkdown: false,
          detectHtml: false
        }
      },
      multiOutput: {
        enabled: false,
        formats: []
      }
    },
    output_format: null // Override for specific execution
  },
  
  defaultWidth: 300,
  defaultHeight: 200,
  
  // AI nodes typically have inputs and outputs
  canHaveInputs: true,
  canHaveOutputs: true,
  maxInputs: -1,  // Can accept multiple inputs
  maxOutputs: -1, // Can produce multiple outputs
  
  /**
   * Execute AI agent node with routing support
   * @param {Object} node - The node data
   * @param {Object} context - Execution context (includes input, routing_config, output_format)
   * @returns {Promise<Object>} Execution result
   */
  async execute(node, context) {
    const config = node.config || {};
    const { ai_agent_id, routing_config, output_format } = config;
    const { input, routing_config: contextRoutingConfig, output_format: contextOutputFormat, history = [] } = context;
    
    // Determine routing configuration (context overrides node config)
    const finalRoutingConfig = contextRoutingConfig || routing_config || config.routing_config;
    const finalOutputFormat = contextOutputFormat || output_format;
    
    try {
      let aiResult;
      
      if (ai_agent_id) {
        // Execute with AI Agent from GOD CRM
        aiResult = await executeAI({
          agentId: ai_agent_id,
          input: input || node.content || '',
          temperature: config.temperature,
          maxTokens: config.max_tokens,
          model: config.model,
          history
        });
      } else {
        // Execute with simple AI (no agent, use config directly)
        const provider = config.provider || 'openai';
        const model = config.model || 'gpt-4o-mini';
        
        aiResult = await executeSimpleAI({
          input: input || node.content || '',
          systemPrompt: config.system_prompt || config.prompt_template || 'You are a helpful assistant.',
          model,
          temperature: config.temperature || 0.7,
          maxTokens: config.max_tokens || 2000,
          provider
        });
      }
      
      if (!aiResult.success) {
        return {
          success: false,
          error: aiResult.error || 'AI execution failed',
          type: 'ai_agent'
        };
      }
      
      // Auto-detect content type if auto-routing is enabled
      let detectedType = null;
      if (finalRoutingConfig?.autoRouting?.enabled && aiResult.content) {
        detectedType = this.detectContentType(aiResult.content);
        apiLogger.debug({ detectedType, contentPreview: aiResult.content.slice(0, 100) }, 'Auto-detected content type');
      }
      
      // Determine which output route to use
      const selectedRoute = this.selectOutputRoute(finalRoutingConfig, finalOutputFormat, detectedType);
      
      // Format output based on selected route if needed
      let formattedOutput = aiResult.content;
      if (selectedRoute?.type && selectedRoute.type !== 'text') {
        formattedOutput = this.formatOutputForRoute(aiResult.content, selectedRoute);
      }
      
      // Build result
      const result = {
        success: true,
        output: formattedOutput,
        outputs: finalRoutingConfig?.multiOutput?.enabled 
          ? this.generateMultipleOutputFormats(aiResult.content, finalRoutingConfig) 
          : undefined,
        selectedRoute: selectedRoute?.id,
        detectedType,
        tokensUsed: aiResult.usage?.totalTokens || 0,
        executionTime: aiResult.executionTime || 0,
        cost: this.calculateCost(aiResult.provider, aiResult.usage),
        model: aiResult.model,
        provider: aiResult.provider,
        type: 'ai_agent',
        agentId: ai_agent_id,
        agentName: aiResult.agentName,
        finishReason: aiResult.finishReason,
        config: {
          temperature: config.temperature || 0.7,
          max_tokens: config.max_tokens || 2000,
          routing_config: finalRoutingConfig
        }
      };
      
      apiLogger.info({ 
        agentId: ai_agent_id, 
        selectedRoute: selectedRoute?.id, 
        detectedType,
        tokensUsed: result.tokensUsed,
        executionTime: result.executionTime
      }, 'AI agent node executed with real AI');
      
      // Log execution metrics
      await logExecutionMetrics({
        labId: context.labId || node.lab_id || 'unknown',
        nodeId: node.node_id || 'unknown',
        nodeType: 'ai_agent',
        agentId: ai_agent_id,
        model: aiResult.model,
        provider: aiResult.provider,
        inputTokens: aiResult.usage?.promptTokens || 0,
        outputTokens: aiResult.usage?.completionTokens || 0,
        totalTokens: aiResult.usage?.totalTokens || 0,
        cost: result.cost,
        executionTime: result.executionTime,
        success: true
      });
      
      return result;
      
    } catch (error) {
      apiLogger.error({ error, agentId: ai_agent_id }, 'AI agent execution failed');
      
      // Log failed execution metrics
      await logExecutionMetrics({
        labId: context.labId || node.lab_id || 'unknown',
        nodeId: node.node_id || 'unknown',
        nodeType: 'ai_agent',
        agentId: ai_agent_id,
        model: config.model,
        provider: config.provider,
        success: false,
        error: error.message
      });
      
      return {
        success: false,
        error: 'AI agent execution failed',
        details: error.message,
        type: 'ai_agent'
      };
    }
  },
  
  /**
   * Detect content type for auto-routing
   * @param {string} content - Content to analyze
   * @returns {string} Detected content type
   */
  detectContentType(content) {
    if (!content) return 'text';
    
    // Try to detect JSON
    try {
      JSON.parse(content.trim());
      return 'json';
    } catch {}
    
    // Detect code blocks
    if (/```[\s\S]*?```|`[^`]+`/.test(content)) {
      return 'code';
    }
    
    // Detect HTML tags
    if (/<[^>]+>/.test(content)) {
      return 'html';
    }
    
    // Detect markdown features
    if (/#{1,6}\s|^\*|\*\*.*\*\*|\[.*\]\(.*\)|^\d+\.\s/m.test(content)) {
      return 'markdown';
    }
    
    return 'text';
  },
  
  /**
   * Select appropriate output route
   * @param {Object} routingConfig - Routing configuration
   * @param {string} outputFormat - Explicit output format
   * @param {string} detectedType - Auto-detected content type
   * @returns {Object} Selected output route
   */
  selectOutputRoute(routingConfig, outputFormat, detectedType) {
    if (!routingConfig?.outputs) {
      return { id: 'text', type: 'text', label: 'Text', contentType: 'text/plain' };
    }
    
    // Use explicit output format if provided
    if (outputFormat) {
      const route = routingConfig.outputs.find(r => r.type === outputFormat && r.enabled);
      if (route) return route;
    }
    
    // Use auto-detected type if auto-routing is enabled
    if (routingConfig.autoRouting?.enabled && detectedType) {
      const route = routingConfig.outputs.find(r => r.type === detectedType && r.enabled);
      if (route) return route;
    }
    
    // Fall back to default output
    const defaultRoute = routingConfig.outputs.find(r => r.id === routingConfig.defaultOutput && r.enabled);
    if (defaultRoute) return defaultRoute;
    
    // Fall back to first enabled route
    const firstEnabled = routingConfig.outputs.find(r => r.enabled);
    return firstEnabled || routingConfig.outputs[0];
  },
  
  /**
   * Format output for a specific route type
   * @param {string} content - Raw AI output
   * @param {Object} route - Target route
   * @returns {string} Formatted output
   */
  formatOutputForRoute(content, route) {
    if (!content || !route?.type) return content;
    
    switch (route.type) {
      case 'json':
        // Try to extract JSON from content or wrap it
        try {
          // Check if content is already valid JSON
          JSON.parse(content);
          return content;
        } catch {
          // Try to find JSON in the content
          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            return jsonMatch[1].trim();
          }
          // Wrap as JSON object
          return JSON.stringify({ content, timestamp: new Date().toISOString() }, null, 2);
        }
      
      case 'markdown':
        // Content is likely already markdown from AI
        return content;
      
      case 'html':
        // Check if content has HTML tags
        if (/<[^>]+>/.test(content)) {
          return content;
        }
        // Convert markdown-like content to basic HTML
        return `<div class="ai-response">${content.replace(/\n/g, '<br>')}</div>`;
      
      case 'code':
        // Try to extract code blocks
        const codeMatch = content.match(/```(?:\w+)?\s*([\s\S]*?)\s*```/);
        if (codeMatch) {
          return codeMatch[1].trim();
        }
        return content;
      
      default:
        return content;
    }
  },
  
  /**
   * Generate multiple output formats from AI content
   * @param {string} content - AI output content
   * @param {Object} routingConfig - Routing configuration
   * @returns {Object} Multiple formatted outputs
   */
  generateMultipleOutputFormats(content, routingConfig) {
    const outputs = {};
    
    if (routingConfig.multiOutput?.formats) {
      routingConfig.multiOutput.formats.forEach(format => {
        const route = routingConfig.outputs.find(r => r.type === format && r.enabled);
        if (route) {
          outputs[route.id] = this.formatOutputForRoute(content, route);
        }
      });
    }
    
    return outputs;
  },
  
  /**
   * Calculate cost based on provider and usage
   * @param {string} provider - Provider name
   * @param {Object} usage - Token usage
   * @returns {number} Estimated cost in USD
   */
  calculateCost(provider, usage) {
    if (!usage) return 0;
    
    // Approximate rates per 1K tokens (input/output)
    const rates = {
      'openai': { input: 0.0015, output: 0.002 },      // GPT-4o-mini
      'anthropic': { input: 0.003, output: 0.015 },    // Claude 3 Sonnet
      'google': { input: 0.00025, output: 0.0005 },    // Gemini 1.5 Flash
      'default': { input: 0.001, output: 0.002 }
    };
    
    const rate = rates[provider?.toLowerCase()] || rates.default;
    const inputCost = (usage.promptTokens || 0) / 1000 * rate.input;
    const outputCost = (usage.completionTokens || 0) / 1000 * rate.output;
    
    return Math.round((inputCost + outputCost) * 10000) / 10000; // Round to 4 decimal places
  },
  
  /**
   * Validate AI agent node configuration with routing support
   * @param {Object} config - Node configuration
   * @returns {Object} Validation result
   */
  validate(config) {
    const errors = [];
    
    if (config.temperature !== undefined) {
      if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2) {
        errors.push('temperature must be a number between 0 and 2');
      }
    }
    
    if (config.max_tokens !== undefined) {
      if (typeof config.max_tokens !== 'number' || config.max_tokens < 1 || config.max_tokens > 32000) {
        errors.push('max_tokens must be a number between 1 and 32000');
      }
    }
    
    if (config.ai_agent_id !== undefined && config.ai_agent_id !== null) {
      if (typeof config.ai_agent_id !== 'number' || config.ai_agent_id < 1) {
        errors.push('ai_agent_id must be a positive number');
      }
    }
    
    // Validate routing configuration
    if (config.routing_config) {
      const routingErrors = this.validateRoutingConfig(config.routing_config);
      errors.push(...routingErrors);
    }
    
    // Validate output format
    if (config.output_format !== undefined && config.output_format !== null) {
      const validFormats = ['text', 'json', 'markdown', 'html', 'code', 'yaml', 'xml', 'csv'];
      if (!validFormats.includes(config.output_format)) {
        errors.push(`output_format must be one of: ${validFormats.join(', ')}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  },
  
  /**
   * Validate routing configuration
   * @param {Object} routingConfig - Routing configuration to validate
   * @returns {Array} Array of validation errors
   */
  validateRoutingConfig(routingConfig) {
    const errors = [];
    
    if (!routingConfig.outputs || !Array.isArray(routingConfig.outputs)) {
      errors.push('routing_config.outputs must be an array');
      return errors;
    }
    
    if (routingConfig.outputs.length === 0) {
      errors.push('routing_config.outputs must contain at least one output');
      return errors;
    }
    
    // Validate each output route
    routingConfig.outputs.forEach((output, index) => {
      if (!output.id) {
        errors.push(`routing_config.outputs[${index}].id is required`);
      }
      
      if (!output.type) {
        errors.push(`routing_config.outputs[${index}].type is required`);
      } else {
        const validTypes = ['text', 'json', 'markdown', 'html', 'code', 'yaml', 'xml', 'csv'];
        if (!validTypes.includes(output.type)) {
          errors.push(`routing_config.outputs[${index}].type must be one of: ${validTypes.join(', ')}`);
        }
      }
      
      if (!output.label) {
        errors.push(`routing_config.outputs[${index}].label is required`);
      }
      
      if (!output.contentType) {
        errors.push(`routing_config.outputs[${index}].contentType is required`);
      }
      
      if (typeof output.enabled !== 'boolean') {
        errors.push(`routing_config.outputs[${index}].enabled must be a boolean`);
      }
    });
    
    // Validate default output exists
    if (routingConfig.defaultOutput) {
      const defaultExists = routingConfig.outputs.some(output => output.id === routingConfig.defaultOutput);
      if (!defaultExists) {
        errors.push('routing_config.defaultOutput must reference an existing output id');
      }
    }
    
    return errors;
  }
};