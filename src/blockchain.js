/**
 * Blockchain Connector — zkTanenbaum (zkSYS Testnet)
 * Direct on-chain interaction with PetRegistry smart contract.
 * Chain ID: 57057 | RPC: https://rpc-zk.tanenbaum.io
 */
require('dotenv').config();
const { ethers } = require('ethers');

const PETREGISTRY_ABI = [
  // Pet Registration
  'function registerPet(string name, string animalType, string metadataURI) external returns (uint256)',
  'function updatePetMetadata(uint256 petId, string metadataURI) external',
  // Lost Mode
  'function setLostMode(uint256 petId, bool lost, string approxArea) external payable',
  'function addReward(uint256 petId) external payable',
  // Sighting Reports
  'function reportSighting(uint256 petId, string approxArea, string noteURI) external payable returns (uint256)',
  // General Reports
  'function createGeneralReport(uint8 reportType, string metadataURI, string zone) external returns (uint256)',
  // Case Resolution
  'function resolveCase(uint256 petId, uint256 reportId, bool accept) external',
  'function claimReward(uint256 petId, uint256 reportId) external',
  // View Functions
  'function getPet(uint256 petId) external view returns (address owner, string name, string animalType, string metadataURI, uint8 status, uint256 rewardWei, string approxArea, uint64 createdAt, uint64 updatedAt, uint32 reportCount)',
  'function getSighting(uint256 reportId) external view returns (uint256 petId, address reporter, string approxArea, string noteURI, uint256 stakeWei, uint8 status, uint64 createdAt)',
  'function getGeneralReport(uint256 reportId) external view returns (address reporter, uint8 reportType, string metadataURI, string zone, uint64 createdAt)',
  'function getPetsByOwner(address owner) external view returns (uint256[])',
  'function getPetReportIds(uint256 petId) external view returns (uint256[])',
  'function getGeneralReportsByReporter(address reporter) external view returns (uint256[])',
  'function totalPets() external view returns (uint256)',
  'function totalReports() external view returns (uint256)',
  'function totalGeneralReports() external view returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function MIN_STAKE() external view returns (uint256)',
  // Events
  'event PetRegistered(uint256 indexed petId, address indexed owner, string name, string animalType, string metadataURI)',
  'event LostModeSet(uint256 indexed petId, bool active, uint256 rewardWei, string approxArea)',
  'event SightingReported(uint256 indexed petId, uint256 indexed reportId, address indexed reporter, string approxArea, uint256 stakeWei)',
  'event CaseResolved(uint256 indexed petId, uint256 indexed reportId, bool accepted)',
  'event GeneralReportCreated(uint256 indexed reportId, address indexed reporter, uint8 reportType, string zone)',
];

const PET_STATUS = ['SAFE', 'LOST', 'FOUND'];
const REPORT_STATUS = ['PENDING', 'ACCEPTED', 'REJECTED'];
const GENERAL_REPORT_TYPE = ['LOST', 'FOUND', 'SIGHTING', 'ABANDONED'];

class BlockchainConnector {
  constructor() {
    this.rpcUrl = process.env.RPC_URL || 'https://rpc-zk.tanenbaum.io';
    this.chainId = parseInt(process.env.CHAIN_ID || '57057');
    this.contractAddress = process.env.CONTRACT_ADDRESS || '0x7Ff5e0f9c8bb86422D5d1a6560b8cD67e8d99289';
    this.explorerUrl = process.env.EXPLORER_URL || 'https://explorer-zk.tanenbaum.io';
    this.provider = null;
    this.contract = null;
    this.wallet = null;
    this.connected = false;
  }

  async connect() {
    try {
      this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
      const network = await this.provider.getNetwork();
      console.log(`[Blockchain] Connected to chain ${network.chainId} (${this.rpcUrl})`);

      // Read-only contract
      this.contract = new ethers.Contract(this.contractAddress, PETREGISTRY_ABI, this.provider);

      // If private key available, create wallet for write operations
      if (process.env.AGENT_PRIVATE_KEY) {
        this.wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, this.provider);
        this.contractWrite = new ethers.Contract(this.contractAddress, PETREGISTRY_ABI, this.wallet);
        console.log(`[Blockchain] Agent wallet: ${this.wallet.address}`);
      } else {
        console.log('[Blockchain] No AGENT_PRIVATE_KEY — read-only mode');
      }

      this.connected = true;
      return { success: true, chainId: Number(network.chainId), contract: this.contractAddress };
    } catch (err) {
      console.error(`[Blockchain] Connection failed: ${err.message}`);
      this.connected = false;
      return { success: false, error: err.message };
    }
  }

  // ── Read Functions ──────────────────────────────────────

  async getOnChainStats() {
    if (!this.connected) return { error: 'Not connected to blockchain' };
    try {
      const [totalPets, totalReports, totalGeneralReports] = await Promise.all([
        this.contract.totalPets(),
        this.contract.totalReports(),
        this.contract.totalGeneralReports(),
      ]);
      return {
        success: true,
        chain: `zkTanenbaum (${this.chainId})`,
        contract: this.contractAddress,
        explorer: `${this.explorerUrl}/address/${this.contractAddress}`,
        totalPets: Number(totalPets),
        totalSightingReports: Number(totalReports),
        totalGeneralReports: Number(totalGeneralReports),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getPet(petId) {
    if (!this.connected) return { error: 'Not connected' };
    try {
      const result = await this.contract.getPet(petId);
      return {
        success: true,
        petId,
        owner: result[0],
        name: result[1],
        animalType: result[2],
        metadataURI: result[3],
        status: PET_STATUS[Number(result[4])] || 'UNKNOWN',
        rewardWei: result[5].toString(),
        rewardSYS: ethers.formatEther(result[5]),
        approxArea: result[6],
        createdAt: new Date(Number(result[7]) * 1000).toISOString(),
        updatedAt: new Date(Number(result[8]) * 1000).toISOString(),
        reportCount: Number(result[9]),
        explorerUrl: `${this.explorerUrl}/address/${this.contractAddress}`,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getLostPets(maxCheck = 50) {
    if (!this.connected) return { error: 'Not connected' };
    try {
      const total = Number(await this.contract.totalPets());
      const lostPets = [];
      const limit = Math.min(total, maxCheck);

      for (let i = 1; i <= limit; i++) {
        try {
          const pet = await this.contract.getPet(i);
          if (Number(pet[4]) === 1) { // LOST
            lostPets.push({
              petId: i,
              name: pet[1],
              animalType: pet[2],
              status: 'LOST',
              rewardSYS: ethers.formatEther(pet[5]),
              approxArea: pet[6],
              reportCount: Number(pet[9]),
            });
          }
        } catch { /* pet may not exist */ }
      }
      return { success: true, lostPets, totalChecked: limit };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getSighting(reportId) {
    if (!this.connected) return { error: 'Not connected' };
    try {
      const r = await this.contract.getSighting(reportId);
      return {
        success: true,
        reportId,
        petId: Number(r[0]),
        reporter: r[1],
        approxArea: r[2],
        noteURI: r[3],
        stakeWei: r[4].toString(),
        status: REPORT_STATUS[Number(r[5])] || 'UNKNOWN',
        createdAt: new Date(Number(r[6]) * 1000).toISOString(),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async getGeneralReport(reportId) {
    if (!this.connected) return { error: 'Not connected' };
    try {
      const r = await this.contract.getGeneralReport(reportId);
      return {
        success: true,
        reportId,
        reporter: r[0],
        reportType: GENERAL_REPORT_TYPE[Number(r[1])] || 'UNKNOWN',
        metadataURI: r[2],
        zone: r[3],
        createdAt: new Date(Number(r[4]) * 1000).toISOString(),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Write Functions (require AGENT_PRIVATE_KEY) ─────────

  async createGeneralReportOnChain(reportType, metadataURI, zone) {
    if (!this.contractWrite) return { success: false, error: 'No wallet configured (AGENT_PRIVATE_KEY required)' };
    try {
      const typeIndex = GENERAL_REPORT_TYPE.indexOf(reportType.toUpperCase());
      if (typeIndex === -1) return { success: false, error: `Invalid report type: ${reportType}` };

      const tx = await this.contractWrite.createGeneralReport(typeIndex, metadataURI, zone);
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return this.contract.interface.parseLog(l)?.name === 'GeneralReportCreated'; } catch { return false; }
      });

      let reportId = null;
      if (event) {
        const parsed = this.contract.interface.parseLog(event);
        reportId = Number(parsed.args[0]);
      }

      return {
        success: true,
        txHash: receipt.hash,
        reportId,
        explorerUrl: `${this.explorerUrl}/tx/${receipt.hash}`,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async reportSightingOnChain(petId, approxArea, noteURI = '') {
    if (!this.contractWrite) return { success: false, error: 'No wallet configured' };
    try {
      const minStake = await this.contract.MIN_STAKE();
      const tx = await this.contractWrite.reportSighting(petId, approxArea, noteURI, { value: minStake });
      const receipt = await tx.wait();

      return {
        success: true,
        txHash: receipt.hash,
        explorerUrl: `${this.explorerUrl}/tx/${receipt.hash}`,
        stakeWei: minStake.toString(),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getExplorerLink(type, hash) {
    return `${this.explorerUrl}/${type}/${hash}`;
  }

  isConnected() {
    return this.connected;
  }

  getInfo() {
    return {
      connected: this.connected,
      chainId: this.chainId,
      network: 'zkTanenbaum (zkSYS Testnet)',
      rpcUrl: this.rpcUrl,
      contractAddress: this.contractAddress,
      explorerUrl: this.explorerUrl,
      walletConfigured: !!this.wallet,
      walletAddress: this.wallet?.address || null,
    };
  }
}

module.exports = { BlockchainConnector, PET_STATUS, REPORT_STATUS, GENERAL_REPORT_TYPE };
