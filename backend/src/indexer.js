const { JsonRpcProvider, Contract } = require('ethers');
const PetRegistryABI = require('./abi/PetRegistry.json');
const { OffChainStore, ReportType, ExtendedStatus } = require('./store/OffChainStore');

// On-chain status mapping
const ON_CHAIN_STATUS = { SAFE: 0, LOST: 1, FOUND: 2 };

class Indexer {
  constructor() {
    this.rpcUrl = process.env.RPC_URL || 'https://rpc.tanenbaum.io';
    this.chainId = parseInt(process.env.CHAIN_ID || '5700');
    this.contractAddress = process.env.CONTRACT_ADDRESS || '';
    
    this.pets = new Map();
    this.reports = new Map();
    this.lostPets = [];
    this.foundPets = [];
    this.stats = {
      totalPets: 0,
      totalReports: 0,
      lostPets: 0,
      foundPets: 0,
      lastIndexed: null,
    };
    
    // Off-chain store para reportes/custodia
    this.offChain = new OffChainStore();
    
    this.provider = null;
    this.contract = null;
    this.intervalId = null;
    this._lastIndexedPetCount = 0;
    this._lastIndexedReportCount = 0;
  }

  start() {
    try {
      this.provider = new JsonRpcProvider(this.rpcUrl, this.chainId, {
        staticNetwork: true,
      });
      
      if (this.contractAddress) {
        this.contract = new Contract(this.contractAddress, PetRegistryABI, this.provider);
        console.log('[Indexer] Contrato conectado:', this.contractAddress);
        
        // Indexar inmediatamente
        this.indexAll();
        
        // Re-indexar cada 30 segundos
        this.intervalId = setInterval(() => this.indexAll(), 30000);
      } else {
        console.warn('[Indexer] No hay dirección de contrato configurada');
      }
    } catch (err) {
      console.error('[Indexer] Error al iniciar:', err.message);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async indexAll() {
    if (!this.contract) return;

    try {
      const totalPets = await this.contract.totalPets();
      const totalReports = await this.contract.totalReports();
      const total = Number(totalPets);
      const totalReps = Number(totalReports);

      // Indexar solo mascotas nuevas o actualizadas
      const startPet = Math.max(1, this._lastIndexedPetCount > 0 ? 1 : 1);
      let lostCount = 0;
      let foundCount = 0;
      const lostPetsList = [];
      const foundPetsList = [];

      for (let i = 1; i <= total; i++) {
        try {
          const result = await this.contract.getPet(i);
          const pet = {
            id: i,
            owner: result[0],
            name: result[1],
            animalType: result[2],
            metadataURI: result[3],
            status: Number(result[4]),
            statusLabel: this._statusLabel(Number(result[4])),
            rewardWei: result[5].toString(),
            approxArea: result[6],
            createdAt: Number(result[7]),
            updatedAt: Number(result[8]),
            reportCount: Number(result[9]),
            // Enriquecer con datos off-chain
            source: 'on-chain',
          };
          
          // Parsear metadata si es JSON
          try {
            if (pet.metadataURI && pet.metadataURI.startsWith('{')) {
              const meta = JSON.parse(pet.metadataURI);
              pet.description = meta.description || '';
              pet.photoUrl = meta.photo || '';
              pet.zone = meta.zone || pet.approxArea;
              pet.contact = meta.contact || '';
              pet.isLostReport = meta.lost === true;
              pet.isFoundReport = meta.found === true;
              pet.isPublic = meta.public !== false; // false solo si explicitamente false
            } else {
              pet.isPublic = true; // sin metadata = público por defecto
            }
          } catch (_) { pet.isPublic = true; }
          
          this.pets.set(i, pet);
          
          if (pet.status === ON_CHAIN_STATUS.LOST && pet.isPublic !== false) {
            lostCount++;
            lostPetsList.push(pet);
          } else if (pet.status === ON_CHAIN_STATUS.FOUND && pet.isPublic !== false) {
            foundCount++;
            foundPetsList.push(pet);
          }
        } catch (err) {
          // Pet might not exist
        }
      }

      // Indexar reportes on-chain (sightings)
      for (let i = 1; i <= totalReps; i++) {
        try {
          const result = await this.contract.getSighting(i);
          this.reports.set(i, {
            id: i,
            petId: Number(result[0]),
            reporter: result[1],
            approxArea: result[2],
            noteURI: result[3],
            stakeWei: result[4].toString(),
            status: Number(result[5]),
            createdAt: Number(result[6]),
            source: 'on-chain',
          });
        } catch (err) {
          // Report might not exist
        }
      }

      this._lastIndexedPetCount = total;
      this._lastIndexedReportCount = totalReps;
      this.lostPets = lostPetsList;
      this.foundPets = foundPetsList;
      
      const offChainStats = this.offChain.getStats();
      this.stats = {
        totalPets: total,
        totalReportsOnChain: totalReps,
        totalReportsOffChain: offChainStats.totalReports,
        lostPetsOnChain: lostCount,
        foundPetsOnChain: foundCount,
        lostReportsOffChain: offChainStats.lostReports,
        foundReportsOffChain: offChainStats.foundReports,
        sightingsOffChain: offChainStats.sightings,
        activeCustodies: offChainStats.activeCustodies,
        lastIndexed: new Date().toISOString(),
      };

      console.log(`[Indexer] Indexado: ${total} pets, ${lostCount} perdidos, ${foundCount} encontrados, ${totalReps} reportes on-chain, ${offChainStats.totalReports} off-chain`);
    } catch (err) {
      console.error('[Indexer] Error indexando:', err.message);
    }
  }

  _statusLabel(status) {
    switch (status) {
      case 0: return 'SAFE';
      case 1: return 'LOST';
      case 2: return 'FOUND';
      default: return 'UNKNOWN';
    }
  }

  // Getters
  getPetsCount() { return this.pets.size; }
  getReportsCount() { return this.reports.size; }
  getStats() { return this.stats; }

  getAllPets({ page = 1, limit = 50 } = {}) {
    const all = Array.from(this.pets.values());
    return this._paginate(all, page, limit);
  }

  /**
   * Mascotas perdidas: on-chain (status=LOST) + off-chain (LOST_REPORT)
   */
  getLostPets({ page = 1, limit = 20, zone } = {}) {
    // On-chain lost pets
    let onChain = this.lostPets.map(p => ({ ...p, source: 'on-chain' }));
    
    // Off-chain lost reports
    const offChainResult = this.offChain.getLostReports({ page: 1, limit: 1000, zone });
    const offChain = offChainResult.data.map(r => ({
      id: r.id,
      name: r.petName,
      animalType: r.species,
      description: r.description,
      photoUrl: r.photoUrl,
      zone: r.zone,
      contact: r.contact,
      status: ON_CHAIN_STATUS.LOST,
      statusLabel: 'LOST',
      reporter: r.reporter,
      onChainPetId: r.onChainPetId,
      createdAt: new Date(r.createdAt).getTime() / 1000,
      source: 'off-chain',
      reportType: r.type,
    }));

    // Deduplicar: si un reporte off-chain tiene onChainPetId que ya existe on-chain, omitirlo
    const onChainIds = new Set(onChain.map(p => p.id));
    const dedupedOffChain = offChain.filter(r => !r.onChainPetId || !onChainIds.has(r.onChainPetId));

    let combined = [...onChain, ...dedupedOffChain];
    
    // Filtro por zona
    if (zone) {
      const z = zone.toLowerCase();
      combined = combined.filter(p => 
        (p.approxArea && p.approxArea.toLowerCase().includes(z)) ||
        (p.zone && p.zone.toLowerCase().includes(z))
      );
    }

    // Ordenar por más reciente
    combined.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    return this._paginate(combined, page, limit);
  }

  /**
   * Mascotas encontradas: on-chain (status=FOUND) + off-chain (FOUND_REPORT)
   */
  getFoundPets({ page = 1, limit = 20, zone } = {}) {
    // On-chain found pets
    let onChain = this.foundPets.map(p => ({ ...p, source: 'on-chain' }));
    
    // Off-chain found reports
    const offChainResult = this.offChain.getFoundReports({ page: 1, limit: 1000, zone });
    const offChain = offChainResult.data.map(r => ({
      id: r.id,
      name: r.petName,
      animalType: r.species,
      description: r.description,
      photoUrl: r.photoUrl,
      zone: r.zone,
      contact: r.contact,
      status: ON_CHAIN_STATUS.FOUND,
      statusLabel: r.status,
      reporter: r.reporter,
      custodian: r.hasPet ? r.reporter : null,
      onChainPetId: r.onChainPetId,
      createdAt: new Date(r.createdAt).getTime() / 1000,
      source: 'off-chain',
      reportType: r.type,
      hasPet: r.hasPet,
    }));

    // También incluir mascotas on-chain marcadas como found en metadata
    const onChainFound = Array.from(this.pets.values())
      .filter(p => p.isFoundReport && p.status === ON_CHAIN_STATUS.SAFE)
      .map(p => ({ ...p, source: 'on-chain', statusLabel: 'FOUND' }));

    // Deduplicar: si un reporte off-chain tiene onChainPetId que ya existe on-chain, omitirlo
    const onChainIds = new Set([...onChain.map(p => p.id), ...onChainFound.map(p => p.id)]);
    const dedupedOffChain = offChain.filter(r => !r.onChainPetId || !onChainIds.has(r.onChainPetId));

    let combined = [...onChain, ...dedupedOffChain, ...onChainFound];
    
    if (zone) {
      const z = zone.toLowerCase();
      combined = combined.filter(p => 
        (p.approxArea && p.approxArea.toLowerCase().includes(z)) ||
        (p.zone && p.zone.toLowerCase().includes(z))
      );
    }

    combined.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    return this._paginate(combined, page, limit);
  }

  getPet(id) { return this.pets.get(id) || null; }

  getPetsByOwner(owner) {
    return Array.from(this.pets.values()).filter(
      p => p.owner.toLowerCase() === owner.toLowerCase()
    );
  }

  getReport(id) { return this.reports.get(id) || null; }
  getAllReports() { return Array.from(this.reports.values()); }

  getReportsForPet(petId) {
    return Array.from(this.reports.values()).filter(r => r.petId === petId);
  }

  // =========== UTILIDADES ===========

  _paginate(items, page = 1, limit = 20) {
    const total = items.length;
    const start = (page - 1) * limit;
    const data = items.slice(start, start + limit);
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}

module.exports = { Indexer };
