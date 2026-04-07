/**
 * OpenClaw Compatibility Adapter
 * Provides a standard OpenClaw interface for PETID Agent.
 * Allows the agent to be registered and executed in OpenClaw-compatible environments.
 */
const axios = require('axios');

const AGENT_MANIFEST = {
  id: 'petid-agent',
  name: 'PETID Recovery Agent',
  version: '1.0.0',
  description: 'Autonomous AI agent for lost pet recovery in Latin America',
  capabilities: ['lost_pet_report', 'alert_generation', 'group_indexing', 'community_publishing'],
  model: process.env.CEREBRAS_MODEL || 'llama3.1-8b',
  provider: 'cerebras',
  chain: 'zkTanenbaum (zkSYS Testnet)',
  chainId: parseInt(process.env.CHAIN_ID || '57057'),
  contractAddress: process.env.CONTRACT_ADDRESS || '0x7Ff5e0f9c8bb86422D5d1a6560b8cD67e8d99289',
  explorer: process.env.EXPLORER_URL || 'https://explorer-zk.tanenbaum.io',
  tokenSymbol: 'PET',
  tasks: [
    { id: 'report_lost_pet', description: 'Process a lost pet report and generate alert', input: ['petName', 'species', 'location', 'ownerContact'] },
    { id: 'search_groups', description: 'Search relevant pet recovery groups', input: ['query', 'location'] },
    { id: 'publish_alert', description: 'Publish alert to all indexed channels', input: ['reportId'] },
    { id: 'get_status', description: 'Get agent operational status', input: [] },
  ],
};

class OpenClawAdapter {
  constructor(agent) {
    this.agent = agent;
    this.registryUrl = process.env.OPENCLAW_REGISTRY_URL || 'https://registry.openclaw.io';
    this.agentId = process.env.OPENCLAW_AGENT_ID || null;
    this.registered = false;
    this.taskHistory = [];
  }

  async registerAgent() {
    try {
      const response = await axios.post(
        `${this.registryUrl}/v1/agents/register`,
        AGENT_MANIFEST,
        { timeout: 10000 }
      );
      this.agentId = response.data.agentId;
      this.registered = true;
      console.log(`[OpenClaw] Agent registered with ID: ${this.agentId}`);
      return { success: true, agentId: this.agentId, manifest: AGENT_MANIFEST };
    } catch {
      this.agentId = `PETID-${Date.now()}`;
      this.registered = true;
      console.log(`[OpenClaw] Registry unavailable — local ID assigned: ${this.agentId}`);
      return { success: true, agentId: this.agentId, mode: 'local', manifest: AGENT_MANIFEST };
    }
  }

  async executeTask(taskId, input = {}) {
    const taskRecord = {
      id: `TASK-${Date.now()}`,
      taskId,
      input,
      startTime: Date.now(),
      status: 'running',
    };

    try {
      let result;

      switch (taskId) {
        case 'report_lost_pet':
          result = await this.agent.reportLostPet(input);
          break;

        case 'search_groups':
          result = await this.agent.searchPetGroups(input.query || input.location || '');
          break;

        case 'publish_alert':
          if (!input.report) throw new Error('report object required for publish_alert');
          result = await this.agent.publishToChannels(input.report);
          break;

        case 'get_status':
          result = this.agent.getStatus();
          break;

        case 'chat':
          result = await this.agent.processMessage(input.message || '', input.userId || 'openclaw');
          break;

        default:
          throw new Error(`Unknown task: ${taskId}`);
      }

      taskRecord.status = 'completed';
      taskRecord.result = result;
      taskRecord.duration = Date.now() - taskRecord.startTime;
      this.taskHistory.unshift(taskRecord);
      if (this.taskHistory.length > 100) this.taskHistory.pop();

      return { success: true, taskId, executionId: taskRecord.id, result, duration: taskRecord.duration };
    } catch (err) {
      taskRecord.status = 'failed';
      taskRecord.error = err.message;
      taskRecord.duration = Date.now() - taskRecord.startTime;
      this.taskHistory.unshift(taskRecord);

      return { success: false, taskId, executionId: taskRecord.id, error: err.message };
    }
  }

  reportStatus() {
    const agentStatus = this.agent.getStatus();
    return {
      agentId: this.agentId,
      registered: this.registered,
      manifest: AGENT_MANIFEST,
      operational: agentStatus.status === 'active',
      agent: agentStatus,
      recentTasks: this.taskHistory.slice(0, 10),
      tasksCompleted: this.taskHistory.filter((t) => t.status === 'completed').length,
      tasksFailed: this.taskHistory.filter((t) => t.status === 'failed').length,
    };
  }

  getManifest() {
    return AGENT_MANIFEST;
  }
}

module.exports = { OpenClawAdapter, AGENT_MANIFEST };
