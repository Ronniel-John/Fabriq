-- ============================================================================
-- LAUNDRYOS POSTGRESQL PRODUCTION DDL
-- Cloud SQL for PostgreSQL Multi-Tenant Database Schema
-- Amounts: Integer centavos (1 PHP = 100 centavos)
-- Weights: Exact numeric/decimal(8,2)
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TENANTS TABLE
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255),
    logo_url TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'past_due', 'suspended')),
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(64) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'PHP',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- 2. BRANCHES TABLE (1 branch per tenant for MVP, scalable to multi-branch)
CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(32) NOT NULL,
    address TEXT NOT NULL,
    phone VARCHAR(64) NOT NULL,
    is_main BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_branch_code UNIQUE(tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_branches_tenant_id ON branches(tenant_id);

-- 3. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_uid VARCHAR(128) NOT NULL UNIQUE, -- Firebase Auth UID
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(64),
    avatar_url TEXT,
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_auth_uid ON users(auth_uid);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 4. TENANT MEMBERSHIPS TABLE (Multi-tenant association & RBAC)
CREATE TABLE IF NOT EXISTS tenant_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'staff')),
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_user UNIQUE(tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_role ON tenant_memberships(tenant_id, role);

-- 5. SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    plan VARCHAR(32) NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'growth', 'enterprise')),
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'past_due', 'cancelled')),
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    max_branches INT NOT NULL DEFAULT 1,
    max_staff INT NOT NULL DEFAULT 5,
    monthly_fee_centavos INT NOT NULL DEFAULT 149900, -- ₱1,499.00
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 6. CUSTOMERS TABLE (Strictly tenant isolated)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    mobile VARCHAR(32) NOT NULL,
    email VARCHAR(255),
    notes TEXT,
    total_orders INT NOT NULL DEFAULT 0,
    outstanding_balance_centavos INT NOT NULL DEFAULT 0 CHECK (outstanding_balance_centavos >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_customer_mobile UNIQUE(tenant_id, mobile)
);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(tenant_id, mobile);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(tenant_id, name);

-- 7. SERVICES TABLE
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'Wash & Fold',
    pricing_unit VARCHAR(16) NOT NULL CHECK (pricing_unit IN ('kg', 'piece')),
    unit_price_centavos INT NOT NULL CHECK (unit_price_centavos >= 0),
    min_charge_centavos INT NOT NULL DEFAULT 0 CHECK (min_charge_centavos >= 0),
    min_quantity NUMERIC(8,2) NOT NULL DEFAULT 1.00,
    default_turnaround_hours INT NOT NULL DEFAULT 24,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_service_name UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id, is_active);

-- 8. ORDERS TABLE
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    order_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'washing', 'drying', 'folding', 'ready_for_pickup', 'released', 'cancelled')),
    payment_status VARCHAR(32) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
    subtotal_centavos INT NOT NULL DEFAULT 0 CHECK (subtotal_centavos >= 0),
    discount_centavos INT NOT NULL DEFAULT 0 CHECK (discount_centavos >= 0),
    express_fee_centavos INT NOT NULL DEFAULT 0 CHECK (express_fee_centavos >= 0),
    total_centavos INT NOT NULL DEFAULT 0 CHECK (total_centavos >= 0),
    paid_centavos INT NOT NULL DEFAULT 0 CHECK (paid_centavos >= 0),
    balance_centavos INT NOT NULL DEFAULT 0 CHECK (balance_centavos >= 0),
    notes TEXT,
    expected_ready_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_order_number UNIQUE(tenant_id, order_number)
);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_payment ON orders(tenant_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

-- 9. ORDER ITEMS TABLE (With historical price snapshots)
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
    service_name_snapshot VARCHAR(255) NOT NULL,
    pricing_unit_snapshot VARCHAR(16) NOT NULL,
    unit_price_centavos_snapshot INT NOT NULL,
    quantity NUMERIC(8,2) NOT NULL CHECK (quantity > 0),
    subtotal_centavos INT NOT NULL CHECK (subtotal_centavos >= 0),
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- 10. ORDER STATUS HISTORY TABLE (Immutable audit trail)
CREATE TABLE IF NOT EXISTS order_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    changed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_history_tenant ON order_status_history(tenant_id, timestamp DESC);

-- 11. PAYMENTS TABLE (Immutable financial ledger)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    amount_centavos INT NOT NULL CHECK (amount_centavos > 0),
    method VARCHAR(32) NOT NULL CHECK (method IN ('cash', 'qr_ph', 'card', 'other')),
    reference_number VARCHAR(128) NOT NULL,
    cashier_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_date ON payments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- 12. PAYMENT ATTEMPTS TABLE (QR Ph dynamic idempotency)
CREATE TABLE IF NOT EXISTS payment_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    provider VARCHAR(32) NOT NULL DEFAULT 'paymongo',
    amount_centavos INT NOT NULL CHECK (amount_centavos > 0),
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
    qr_code_url TEXT,
    qr_string TEXT,
    external_reference VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_idempotency ON payment_attempts(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_tenant ON payment_attempts(tenant_id, status);

-- 13. PAYMENT CONNECTIONS TABLE (Per-tenant merchant gateway)
CREATE TABLE IF NOT EXISTS payment_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    provider VARCHAR(32) NOT NULL DEFAULT 'paymongo',
    status VARCHAR(32) NOT NULL DEFAULT 'sandbox' CHECK (status IN ('connected', 'disconnected', 'sandbox')),
    public_key TEXT,
    webhook_secret TEXT,
    merchant_id VARCHAR(128),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(128) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(128),
    metadata JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
