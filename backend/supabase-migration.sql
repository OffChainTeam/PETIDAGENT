-- =============================================================
-- PetSys - Migracion a Supabase
-- Ejecutar en: Supabase Dashboard > SQL Editor > New Query
-- =============================================================

-- Tabla de reportes off-chain
CREATE TABLE IF NOT EXISTS reports (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  reporter         TEXT,
  onchainpetid     INTEGER,
  parentreportid   TEXT,
  petname          TEXT DEFAULT '',
  species          TEXT DEFAULT '',
  description      TEXT DEFAULT '',
  photourl         TEXT DEFAULT '',
  zone             TEXT DEFAULT '',
  contact          TEXT DEFAULT '',
  haspet           BOOLEAN DEFAULT FALSE,
  txhash           TEXT,
  status           TEXT,
  metadata         TEXT DEFAULT '{}',
  createdat        TEXT,
  updatedat        TEXT,
  resolved         BOOLEAN DEFAULT FALSE,
  resolvedat       TEXT,
  resolvedby       TEXT
);

-- Tabla de custodias
CREATE TABLE IF NOT EXISTS custodies (
  id                TEXT PRIMARY KEY,
  custodian         TEXT,
  assignedat        TEXT,
  reason            TEXT DEFAULT 'FINDER',
  previouscustodian TEXT
);

-- Indices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports (type);
CREATE INDEX IF NOT EXISTS idx_reports_resolved ON reports (resolved);
CREATE INDEX IF NOT EXISTS idx_reports_createdat ON reports (createdat DESC);
CREATE INDEX IF NOT EXISTS idx_reports_onchainpetid ON reports (onchainpetid);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter);

-- Deshabilitar RLS (hackathon mode - acceso via service key)
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodies ENABLE ROW LEVEL SECURITY;

-- Politica permisiva para el backend (usa service_role key)
CREATE POLICY "Allow all for service role" ON reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON custodies FOR ALL USING (true) WITH CHECK (true);

-- =============================================================
-- Tabla de faucet claims (fondos enviados a billeteras nuevas)
-- =============================================================
CREATE TABLE IF NOT EXISTS faucet_claims (
  id         SERIAL PRIMARY KEY,
  address    TEXT NOT NULL UNIQUE,
  amount     TEXT NOT NULL,
  tx_hash    TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faucet_claims_address ON faucet_claims (address);

ALTER TABLE faucet_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role on faucet" ON faucet_claims FOR ALL USING (true) WITH CHECK (true);
