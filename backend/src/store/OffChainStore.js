/**
 * OffChainStore - Almacen Supabase para datos que NO van on-chain.
 *
 * Resuelve el problema central: separar propiedad (on-chain NFT owner)
 * de reportes/custodia (off-chain) con persistencia real entre deploys.
 *
 * Roles:
 *   - owner:     Dueno real del NFT on-chain (solo quien llamo registerPet)
 *   - reporter:  Quien crea un reporte de perdida o hallazgo
 *   - custodian: Quien tiene fisicamente la mascota (puede ser != owner)
 *   - viewer:    Quien reporta un avistamiento (no altera custodia)
 *
 * Persistencia: Supabase (PostgreSQL) via SUPABASE_URL + SUPABASE_SERVICE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

// Estados extendidos que complementan los on-chain (SAFE=0, LOST=1, FOUND=2)
const ExtendedStatus = {
  REGISTERED:     'REGISTERED',
  LOST:           'LOST',
  FOUND:          'FOUND',
  IN_TEMP_CUSTODY:'IN_TEMP_CUSTODY',
  IN_SHELTER:     'IN_SHELTER',
  RECLAIMED:      'RECLAIMED',
  CLOSED:         'CLOSED',
};

const ReportType = {
  LOST_REPORT:        'LOST_REPORT',
  FOUND_REPORT:       'FOUND_REPORT',
  SIGHTING:           'SIGHTING',
  SIGHTING_ABANDONED: 'SIGHTING_ABANDONED',
  CUSTODY_TRANSFER:   'CUSTODY_TRANSFER',
};

class OffChainStore {
  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL y SUPABASE_SERVICE_KEY son requeridos');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /** Llamar una vez antes de arrancar el servidor */
  async init() {
    const { count, error } = await this.supabase
      .from('reports')
      .select('*', { count: 'exact', head: true });

    if (error) {
      throw new Error(`[OffChainStore] Error conectando a Supabase: ${error.message}`);
    }

    console.log(`[OffChainStore] Supabase listo: ${count || 0} reportes.`);
    return this;
  }

  // =========== HELPERS ===========

  _rowToReport(row) {
    if (!row) return null;
    return {
      id:             row.id,
      type:           row.type,
      reporter:       row.reporter,
      onChainPetId:   row.onchainpetid,
      parentReportId: row.parentreportid,
      petName:        row.petname,
      species:        row.species,
      description:    row.description,
      photoUrl:       row.photourl,
      zone:           row.zone,
      contact:        row.contact,
      hasPet:         row.haspet,
      txHash:         row.txhash,
      status:         row.status,
      metadata:       row.metadata ? JSON.parse(row.metadata) : {},
      createdAt:      row.createdat,
      updatedAt:      row.updatedat,
      resolved:       row.resolved,
      resolvedAt:     row.resolvedat,
      resolvedBy:     row.resolvedby,
    };
  }

  _rowToCustody(row) {
    if (!row) return null;
    return {
      id:                row.id,
      custodian:         row.custodian,
      assignedAt:        row.assignedat,
      reason:            row.reason,
      previousCustodian: row.previouscustodian,
    };
  }

  _inferStatus(type, hasPet) {
    switch (type) {
      case ReportType.LOST_REPORT:        return ExtendedStatus.LOST;
      case ReportType.FOUND_REPORT:       return hasPet ? ExtendedStatus.IN_TEMP_CUSTODY : ExtendedStatus.FOUND;
      case ReportType.SIGHTING:           return ExtendedStatus.LOST;
      case ReportType.SIGHTING_ABANDONED: return ExtendedStatus.FOUND;
      default:                            return ExtendedStatus.REGISTERED;
    }
  }

  async _nextId() {
    const { data } = await this.supabase
      .from('reports')
      .select('id')
      .order('createdat', { ascending: false })
      .limit(1);

    if (!data || data.length === 0) return 'RPT-1';
    const n = parseInt(data[0].id.replace('RPT-', ''), 10) || 0;
    return `RPT-${n + 1}`;
  }

  // =========== REPORTES ===========

  async createReport({
    type, reporter, petName = '', species = '', description = '',
    photoUrl = '', zone = '', contact = '', onChainPetId = null,
    parentReportId = null, hasPet = false, metadata = {}, txHash = null,
  }) {
    const id = await this._nextId();
    const now = new Date().toISOString();
    const status = this._inferStatus(type, hasPet);

    const { error } = await this.supabase.from('reports').insert({
      id,
      type,
      reporter: reporter ? reporter.toLowerCase() : null,
      onchainpetid: onChainPetId || null,
      parentreportid: parentReportId || null,
      petname: petName,
      species,
      description,
      photourl: photoUrl,
      zone,
      contact,
      haspet: hasPet,
      txhash: txHash || null,
      status,
      metadata: JSON.stringify(metadata),
      createdat: now,
      updatedat: now,
      resolved: false,
      resolvedat: null,
      resolvedby: null,
    });

    if (error) throw new Error(`Error creando reporte: ${error.message}`);

    if (hasPet && reporter) {
      await this.setCustody(id, reporter, 'FINDER');
    }

    return this.getReport(id);
  }

  // =========== CUSTODIA ===========

  async setCustody(reportOrPetId, custodianAddress, reason = 'FINDER') {
    const { error } = await this.supabase.from('custodies').upsert({
      id: reportOrPetId,
      custodian: custodianAddress.toLowerCase(),
      assignedat: new Date().toISOString(),
      reason,
      previouscustodian: null,
    }, { onConflict: 'id' });

    if (error) throw new Error(`Error seteando custodia: ${error.message}`);
  }

  async getCustody(reportOrPetId) {
    const { data } = await this.supabase
      .from('custodies')
      .select('*')
      .eq('id', reportOrPetId)
      .maybeSingle();

    return this._rowToCustody(data);
  }

  async transferCustody(reportOrPetId, currentCustodian, newCustodian, reason = 'TRANSFER') {
    const custody = await this.getCustody(reportOrPetId);
    if (!custody) throw new Error('No hay custodia registrada para este ID');
    if (custody.custodian !== currentCustodian.toLowerCase()) {
      throw new Error('Solo el custodio actual puede transferir custodia');
    }

    const { error: custError } = await this.supabase.from('custodies').upsert({
      id: reportOrPetId,
      custodian: newCustodian.toLowerCase(),
      assignedat: new Date().toISOString(),
      reason,
      previouscustodian: currentCustodian.toLowerCase(),
    }, { onConflict: 'id' });

    if (custError) throw new Error(`Error transfiriendo custodia: ${custError.message}`);

    const newStatus = reason === 'SHELTER' ? ExtendedStatus.IN_SHELTER : ExtendedStatus.IN_TEMP_CUSTODY;
    const { error: repError } = await this.supabase
      .from('reports')
      .update({ status: newStatus, updatedat: new Date().toISOString() })
      .eq('id', reportOrPetId);

    if (repError) throw new Error(`Error actualizando reporte: ${repError.message}`);

    return this.getCustody(reportOrPetId);
  }

  // =========== RESOLUCION ===========

  async resolveReport(reportId, resolvedBy, newStatus = ExtendedStatus.CLOSED) {
    const report = await this.getReport(reportId);
    if (!report) throw new Error('Reporte no encontrado');
    if (report.resolved) throw new Error('Reporte ya resuelto');

    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from('reports')
      .update({
        resolved: true,
        resolvedat: now,
        resolvedby: resolvedBy ? resolvedBy.toLowerCase() : null,
        status: newStatus,
        updatedat: now,
      })
      .eq('id', reportId);

    if (error) throw new Error(`Error resolviendo reporte: ${error.message}`);

    return this.getReport(reportId);
  }

  // =========== CONSULTAS ===========

  async getAllReports() {
    const { data, error } = await this.supabase
      .from('reports')
      .select('*')
      .order('createdat', { ascending: false });

    if (error) throw new Error(`Error obteniendo reportes: ${error.message}`);
    return (data || []).map(r => this._rowToReport(r));
  }

  async getReport(id) {
    const { data } = await this.supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    return this._rowToReport(data);
  }

  async getReports({ type, status, reporter, zone, resolved, parentReportId, page = 1, limit = 20 } = {}) {
    let query = this.supabase.from('reports').select('*', { count: 'exact' });

    if (type)                    query = query.eq('type', type);
    if (status)                  query = query.eq('status', status);
    if (reporter)                query = query.eq('reporter', reporter.toLowerCase());
    if (zone)                    query = query.ilike('zone', `%${zone}%`);
    if (resolved !== undefined)  query = query.eq('resolved', resolved);
    if (parentReportId)          query = query.eq('parentreportid', parentReportId);

    const offset = (page - 1) * limit;
    query = query.order('createdat', { ascending: false }).range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(`Error consultando reportes: ${error.message}`);

    return {
      data: (data || []).map(r => this._rowToReport(r)),
      total: count || 0,
      page, limit,
      totalPages: Math.ceil((count || 0) / limit),
    };
  }

  async getLostReports({ page = 1, limit = 20, zone, resolved } = {}) {
    return this.getReports({ type: ReportType.LOST_REPORT, resolved: resolved !== undefined ? resolved : false, zone, page, limit });
  }

  async getFoundReports({ page = 1, limit = 20, zone, resolved } = {}) {
    return this.getReports({ type: ReportType.FOUND_REPORT, resolved: resolved !== undefined ? resolved : false, zone, page, limit });
  }

  async getReportsByReporter(address, { page = 1, limit = 20 } = {}) {
    return this.getReports({ reporter: address, page, limit });
  }

  // =========== STATS ===========

  async getStats() {
    const [totalRes, lostRes, foundRes, sightRes, sightAbRes, resolvedRes, custRes] = await Promise.all([
      this.supabase.from('reports').select('*', { count: 'exact', head: true }),
      this.supabase.from('reports').select('*', { count: 'exact', head: true }).eq('type', 'LOST_REPORT'),
      this.supabase.from('reports').select('*', { count: 'exact', head: true }).eq('type', 'FOUND_REPORT'),
      this.supabase.from('reports').select('*', { count: 'exact', head: true }).eq('type', 'SIGHTING'),
      this.supabase.from('reports').select('*', { count: 'exact', head: true }).eq('type', 'SIGHTING_ABANDONED'),
      this.supabase.from('reports').select('*', { count: 'exact', head: true }).eq('resolved', true),
      this.supabase.from('custodies').select('*', { count: 'exact', head: true }),
    ]);

    const total    = totalRes.count || 0;
    const resolved = resolvedRes.count || 0;

    return {
      totalReports:       total,
      lostReports:        lostRes.count || 0,
      foundReports:       foundRes.count || 0,
      sightings:          sightRes.count || 0,
      sightingsAbandoned: sightAbRes.count || 0,
      resolved,
      pending:            total - resolved,
      activeCustodies:    custRes.count || 0,
    };
  }
}

module.exports = { OffChainStore, ExtendedStatus, ReportType };
