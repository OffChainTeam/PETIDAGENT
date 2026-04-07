/**
 * PETID Group Indexer
 * Maintains a ranked list of top 50 pet recovery groups.
 * Groups are ranked by: activity score, members count, relevance.
 * Rule: Keep only top 50 — replace weakest when a better group appears.
 */

// ====================================================================
// GRUPOS VERIFICADOS — Todas las URLs son reales y clickeables
// Última verificación: Abril 2026
// ====================================================================
const DEFAULT_GROUPS = [
  // ─── PERÚ: Lima (verificados) ───
  { name: 'Mascotas perdidas de todos los distritos de Lima-Perú', platform: 'facebook', location: 'Lima, Perú', members: 85000, activity: 95, relevance: 100, url: 'https://www.facebook.com/groups/240645176495440/', tags: ['peru', 'lima', 'perro', 'gato', 'todos', 'miraflores', 'surco', 'san isidro', 'san borja', 'la molina', 'barranco', 'chorrillos', 'san miguel', 'jesus maria', 'lince', 'pueblo libre', 'magdalena', 'ate', 'santa anita', 'los olivos', 'comas', 'sjl', 'villa el salvador'] },
  { name: 'Mascotas perdidas y encontradas en Lima Peru', platform: 'facebook', location: 'Lima, Perú', members: 62000, activity: 92, relevance: 98, url: 'https://www.facebook.com/groups/1486134498377066/', tags: ['peru', 'lima', 'encontradas', 'miraflores', 'surco', 'san isidro', 'barranco', 'chorrillos', 'la molina'] },
  { name: 'Adopciones y Rescate de Perros y Gatos Lima', platform: 'facebook', location: 'Lima, Perú', members: 45000, activity: 90, relevance: 95, url: 'https://www.facebook.com/groups/444315422396313/', tags: ['peru', 'lima', 'adopcion', 'rescate', 'perro', 'gato', 'miraflores', 'surco', 'san isidro'] },
  { name: 'Perros perdidos (Lima - Perú)', platform: 'facebook', location: 'Lima, Perú', members: 35000, activity: 88, relevance: 96, url: 'https://www.facebook.com/groups/793860427355738/', tags: ['peru', 'lima', 'perro', 'perdido', 'miraflores', 'surco', 'barranco', 'san isidro'] },
  { name: 'Animales en adopción Lima', platform: 'facebook', location: 'Lima, Perú', members: 30000, activity: 86, relevance: 90, url: 'https://www.facebook.com/groups/1433700173348010/', tags: ['peru', 'lima', 'adopcion', 'miraflores', 'surco'] },
  { name: 'Mascotas perdidas SJM - Lima Sur', platform: 'facebook', location: 'San Juan de Miraflores, Lima', members: 16500, activity: 82, relevance: 88, url: 'https://www.facebook.com/groups/646737949097120/', tags: ['lima', 'sjm', 'limasur', 'san juan de miraflores', 'villa maria del triunfo', 'villa el salvador', 'chorrillos'] },

  // ─── PERÚ: Organizaciones reales ───
  { name: 'WUF Perú — Adopción y Rescate', platform: 'web', location: 'Lima, Perú', members: 200000, activity: 97, relevance: 98, url: 'https://www.wuf.pe/', tags: ['peru', 'lima', 'adopcion', 'rescate', 'wuf'] },
  { name: 'Mascotas Perdidas PERÚ (Página oficial)', platform: 'facebook', location: 'Perú (nacional)', members: 50000, activity: 93, relevance: 97, url: 'https://www.facebook.com/mascotasperdidasperu/', tags: ['peru', 'nacional', 'oficial'] },
  { name: 'Mascotas Perdidas Lima (Instagram)', platform: 'instagram', location: 'Lima, Perú', members: 28000, activity: 89, relevance: 92, url: 'https://www.instagram.com/mascotasperdidas.lima/', tags: ['peru', 'lima', 'instagram'] },

  // ─── PERÚ: Arequipa (verificados) ───
  { name: 'MASCOTAS AREQUIPA — Perdidas, adopciones y rescates', platform: 'facebook', location: 'Arequipa, Perú', members: 24000, activity: 83, relevance: 86, url: 'https://www.facebook.com/groups/1612370242365923/', tags: ['arequipa', 'peru', 'perdidas', 'adopcion'] },
  { name: 'Adopciones de Mascotas Mestizas Arequipa', platform: 'facebook', location: 'Arequipa, Perú', members: 15000, activity: 80, relevance: 82, url: 'https://www.facebook.com/groups/1556628317901798/', tags: ['arequipa', 'peru', 'adopcion', 'mestizo'] },

  // ─── PERÚ: Trujillo (verificados) ───
  { name: 'Mascotas Perdidas Trujillo - PERÚ', platform: 'facebook', location: 'Trujillo, Perú', members: 18500, activity: 80, relevance: 83, url: 'https://www.facebook.com/groups/198911640132058/', tags: ['trujillo', 'peru', 'lalibertad'] },

  // ─── COLOMBIA (verificados) ───
  { name: 'ANIMALES PERDIDOS. BOGOTA. COLOMBIA', platform: 'facebook', location: 'Bogotá, Colombia', members: 78000, activity: 91, relevance: 90, url: 'https://www.facebook.com/groups/352631021471266/', tags: ['colombia', 'bogota', 'perdidos'] },
  { name: 'ANIMALITOS PERDIDOS EN COLOMBIA', platform: 'facebook', location: 'Colombia (nacional)', members: 55000, activity: 88, relevance: 87, url: 'https://www.facebook.com/groups/animalitosperdidosencolombia/', tags: ['colombia', 'nacional', 'perdidos'] },

  // ─── MÉXICO (verificados) ───
  { name: 'Mascotas perdidas CDMX', platform: 'facebook', location: 'CDMX, México', members: 120000, activity: 94, relevance: 88, url: 'https://www.facebook.com/groups/175531492994439/', tags: ['mexico', 'cdmx', 'perdidas'] },

  // ─── ARGENTINA (verificados) ───
  { name: 'Mascotas perdidas en Buenos Aires', platform: 'facebook', location: 'Buenos Aires, Argentina', members: 95000, activity: 93, relevance: 88, url: 'https://www.facebook.com/groups/mascotasperdidasenbuenosaires/', tags: ['argentina', 'buenosaires'] },
  { name: 'Mascotas perdidas y encontradas en Capital Federal', platform: 'facebook', location: 'CABA, Argentina', members: 40000, activity: 87, relevance: 85, url: 'https://www.facebook.com/groups/678482645599262/', tags: ['argentina', 'caba', 'capitalfederal'] },

  // ─── CHILE (verificados) ───
  { name: 'Perros Perdidos Santiago - Chile', platform: 'facebook', location: 'Santiago, Chile', members: 65000, activity: 89, relevance: 85, url: 'https://www.facebook.com/groups/557979667691631/', tags: ['chile', 'santiago', 'perro'] },
  { name: 'SOLO MASCOTAS PERDIDAS O ENCONTRADAS (Chile)', platform: 'facebook', location: 'Chile (nacional)', members: 45000, activity: 87, relevance: 84, url: 'https://www.facebook.com/groups/195675330629289/', tags: ['chile', 'nacional', 'perdidas', 'encontradas'] },
  { name: 'ANIMALES PERDIDOS/ENCONTRADOS CHILE', platform: 'facebook', location: 'Chile (nacional)', members: 35000, activity: 85, relevance: 83, url: 'https://www.facebook.com/groups/185121065481026/', tags: ['chile', 'nacional', 'animales'] },

  // ─── REDDIT (verificados) ───
  { name: 'r/lostpets — Lost or Missing Pets', platform: 'reddit', location: 'Global (inglés)', members: 50000, activity: 80, relevance: 78, url: 'https://www.reddit.com/r/lostpets/', tags: ['reddit', 'global', 'english', 'lost'] },
  { name: 'r/lostpet — Lost & Found Pets', platform: 'reddit', location: 'Global (inglés)', members: 30000, activity: 75, relevance: 75, url: 'https://www.reddit.com/r/lostpet/', tags: ['reddit', 'global', 'english', 'found'] },

  // ─── TELEGRAM (canal del proyecto) ───
  { name: 'PETID Agent Bot (Telegram)', platform: 'telegram', location: 'Global', members: 500, activity: 95, relevance: 99, url: 'https://t.me/petid_agent_bot', tags: ['telegram', 'petid', 'bot', 'global'] },
];

class GroupIndexer {
  constructor() {
    this.groups = DEFAULT_GROUPS.map((g, i) => ({
      ...g,
      id: `GRP-${String(i + 1).padStart(3, '0')}`,
      score: this._calcScore(g),
      addedAt: new Date().toISOString(),
    }));
    this._sort();
    this._trim();
  }

  _calcScore(group) {
    const memberScore = Math.min(group.members / 1000, 100);
    const activityScore = group.activity;
    const relevanceScore = group.relevance;
    return Math.round(memberScore * 0.3 + activityScore * 0.35 + relevanceScore * 0.35);
  }

  _sort() {
    this.groups.sort((a, b) => b.score - a.score);
  }

  _trim() {
    if (this.groups.length > 50) {
      this.groups = this.groups.slice(0, 50);
    }
  }

  getTopGroups(limit = 10) {
    return this.groups.slice(0, Math.min(limit, this.groups.length));
  }

  searchGroups(query) {
    if (!query) return this.getTopGroups(10);
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return this.getTopGroups(10);

    const results = this.groups
      .map((g) => {
        const text = `${g.name} ${g.location} ${g.platform} ${g.tags.join(' ')}`.toLowerCase();
        // Exact word matches (high weight)
        const exactMatches = words.filter((w) => text.includes(w)).length;
        // Partial/substring matches (lower weight) for typo tolerance
        const partialMatches = words.filter((w) => {
          if (w.length < 4) return false; // skip short words for partial
          return text.split(/\s+/).some(t => t.includes(w) || w.includes(t));
        }).length;
        const matchScore = exactMatches * 2 + partialMatches * 0.5;
        return { ...g, _matchScore: matchScore };
      })
      .filter((g) => g._matchScore > 0)
      .sort((a, b) => b._matchScore - a._matchScore || b.score - a.score);

    // Si no hay resultados exactos, devolver top groups como fallback
    return results.length > 0 ? results : this.getTopGroups(10);
  }

  addGroup(groupData) {
    const newGroup = {
      ...groupData,
      id: `GRP-${Date.now()}`,
      score: this._calcScore(groupData),
      addedAt: new Date().toISOString(),
    };

    const weakest = this.groups[this.groups.length - 1];
    if (this.groups.length >= 50 && newGroup.score <= weakest.score) {
      return { added: false, reason: 'Score too low to replace weakest group', weakestScore: weakest.score };
    }

    if (this.groups.length >= 50) {
      this.groups.pop();
    }

    this.groups.push(newGroup);
    this._sort();
    return { added: true, group: newGroup };
  }

  updateGroupActivity(groupId, activityDelta) {
    const group = this.groups.find((g) => g.id === groupId);
    if (!group) return false;
    group.activity = Math.min(100, Math.max(0, group.activity + activityDelta));
    group.score = this._calcScore(group);
    this._sort();
    return true;
  }

  getGroupsCount() {
    return this.groups.length;
  }

  getStats() {
    const byPlatform = {};
    this.groups.forEach((g) => {
      byPlatform[g.platform] = (byPlatform[g.platform] || 0) + 1;
    });
    return {
      total: this.groups.length,
      byPlatform,
      topGroup: this.groups[0] || null,
      avgScore: Math.round(this.groups.reduce((s, g) => s + g.score, 0) / this.groups.length),
    };
  }
}

module.exports = { GroupIndexer };
