import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.ts';
import { Database, Table, Key, Copy, Check, FileCode, Layers } from 'lucide-react';

export const SchemaViewer: React.FC = () => {
  const [schemaData, setSchemaData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string>('orders');
  const [activeTab, setActiveTab] = useState<'visual' | 'ddl'>('visual');

  useEffect(() => {
    api
      .getSchema()
      .then((data) => {
        setSchemaData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load schema:', err);
        setLoading(false);
      });
  }, []);

  const handleCopyDDL = () => {
    // Basic DDL snippet
    const ddl = `-- PostgreSQL Schema for LaundryOS Multi-Tenant Architecture
-- See /src/db/schema.sql for the complete production DDL`;
    navigator.clipboard.writeText(ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Loading PostgreSQL relational schema specification...
      </div>
    );
  }

  const currentTable = schemaData?.tables?.find((t: any) => t.tableName === selectedTable);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Normalized Relational Schema (PostgreSQL)</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Cloud SQL Architecture · 14 Tables · Integer Centavos Currency · UUID Primary Keys · Referential Integrity
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 bg-slate-100 rounded-lg text-xs font-medium">
            <button
              onClick={() => setActiveTab('visual')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'visual' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Schema Inspector
            </button>
            <button
              onClick={() => setActiveTab('ddl')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'ddl' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              SQL DDL
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'visual' ? (
        <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-4 lg:gap-6">
          {/* Mobile & Tablet Table Selector (< lg) */}
          <div className="lg:hidden bg-white p-3 rounded-xl border border-slate-200 shadow-xs space-y-1.5">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase">
              Select Relational Table:
            </label>
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              className="w-full text-xs font-mono font-medium text-slate-900 bg-slate-50 border border-slate-300 rounded-lg p-2.5 min-h-[44px]"
            >
              {schemaData?.tables?.map((table: any) => (
                <option key={table.tableName} value={table.tableName}>
                  {table.tableName} ({table.recordCount} rows)
                </option>
              ))}
            </select>
          </div>

          {/* Desktop Table List Sidebar (>= lg) */}
          <div className="hidden lg:block lg:col-span-1 space-y-1 bg-white p-3 rounded-xl border border-slate-200 shadow-sm max-h-[600px] overflow-y-auto">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 py-1 flex items-center justify-between">
              <span>Database Tables ({schemaData?.tables?.length || 14})</span>
              <Layers className="w-3.5 h-3.5" />
            </div>
            {schemaData?.tables?.map((table: any) => (
              <button
                key={table.tableName}
                onClick={() => setSelectedTable(table.tableName)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                  selectedTable === table.tableName
                    ? 'bg-indigo-50 text-indigo-900 font-semibold border border-indigo-200'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Table className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{table.tableName}</span>
                </div>
                <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                  {table.recordCount}
                </span>
              </button>
            ))}
          </div>

          {/* Table Definition Details */}
          <div className="lg:col-span-3 space-y-4">
            {currentTable && (
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold font-mono text-slate-900">{currentTable.tableName}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 font-medium">
                        PostgreSQL Table
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{currentTable.description}</p>
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    Current Records: <strong className="text-slate-800">{currentTable.recordCount}</strong>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 uppercase font-semibold text-[11px]">
                        <th className="py-2.5 px-3">Column Name</th>
                        <th className="py-2.5 px-3">Data Type</th>
                        <th className="py-2.5 px-3">Constraint / Key</th>
                        <th className="py-2.5 px-3">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                      {currentTable.columns?.map((col: any) => (
                        <tr key={col.name} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 font-semibold text-slate-900 flex items-center gap-1.5">
                            {col.key?.includes('PRIMARY') && <Key className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                            <span>{col.name}</span>
                          </td>
                          <td className="py-2.5 px-3 text-indigo-600">{col.type}</td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {col.key || col.check || (col.nullable === false ? 'NOT NULL' : '—')}
                          </td>
                          <td className="py-2.5 px-3 font-sans text-slate-500 text-[11px]">
                            {col.note || (col.default !== undefined ? `Default: ${col.default}` : '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* DDL Code Block */
        <div className="bg-slate-900 rounded-xl p-5 text-slate-100 text-xs font-mono space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-emerald-400" />
              <span>/src/db/schema.sql (PostgreSQL DDL)</span>
            </div>
            <button
              onClick={handleCopyDDL}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Reference'}</span>
            </button>
          </div>
          <pre className="overflow-x-auto text-[11px] leading-relaxed text-slate-300 max-h-[500px]">
{`-- Cloud SQL for PostgreSQL Multi-Tenant Database Schema
-- Integer Centavos (1 PHP = 100 centavos) & Exact Weight Decimals

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. tenants
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'past_due', 'suspended')),
    contact_email VARCHAR(255) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'PHP',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. branches (1 per tenant for MVP)
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(32) NOT NULL,
    address TEXT NOT NULL,
    CONSTRAINT uq_tenant_branch_code UNIQUE(tenant_id, code)
);

-- 3. users (Firebase Auth integration)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_uid VARCHAR(128) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    is_super_admin BOOLEAN DEFAULT FALSE
);

-- 4. tenant_memberships (RBAC)
CREATE TABLE tenant_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'staff')),
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    CONSTRAINT uq_tenant_user UNIQUE(tenant_id, user_id)
);

-- 5. customers (Tenant-isolated)
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    mobile VARCHAR(32) NOT NULL,
    outstanding_balance_centavos INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_customer_mobile UNIQUE(tenant_id, mobile)
);

-- 6. services
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    pricing_unit VARCHAR(16) NOT NULL CHECK (pricing_unit IN ('kg', 'piece')),
    unit_price_centavos INT NOT NULL,
    min_charge_centavos INT NOT NULL DEFAULT 0
);

-- 7. orders & order_items
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    customer_id UUID NOT NULL REFERENCES customers(id),
    order_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'received',
    payment_status VARCHAR(32) NOT NULL DEFAULT 'unpaid',
    total_centavos INT NOT NULL DEFAULT 0,
    paid_centavos INT NOT NULL DEFAULT 0,
    balance_centavos INT NOT NULL DEFAULT 0
);

-- 8. payments (Immutable ledger)
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    amount_centavos INT NOT NULL,
    method VARCHAR(32) NOT NULL CHECK (method IN ('cash', 'qr_ph', 'card', 'other')),
    reference_number VARCHAR(128) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);`}
          </pre>
        </div>
      )}
    </div>
  );
};
