-- Migration 014: Labs Tables (ADR-043)
-- Laboratories feature for AI workflow management
-- Created: 2026-01-24

-- ============================================================
-- Labs Projects Table
-- ============================================================

CREATE TABLE IF NOT EXISTS labs_projects (
    id SERIAL PRIMARY KEY,
    space_id INTEGER REFERENCES spaces(id),
    project_id VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    settings JSONB DEFAULT '{}',
    ai_default_provider_id INTEGER,
    ai_default_agent_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for labs_projects
CREATE INDEX IF NOT EXISTS idx_labs_projects_space ON labs_projects(space_id);
CREATE INDEX IF NOT EXISTS idx_labs_projects_project_id ON labs_projects(project_id);

-- ============================================================
-- Labs Nodes Table
-- ============================================================

CREATE TABLE IF NOT EXISTS labs_nodes (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    node_id VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    meta JSONB DEFAULT '{}',
    ai_config JSONB DEFAULT '{}',
    ai_agent_id INTEGER,
    ai_provider_id INTEGER,
    ai_routing_config JSONB DEFAULT '{}',
    ui_config JSONB DEFAULT '{}',
    ai_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, node_id)
);

-- Indexes for labs_nodes
CREATE INDEX IF NOT EXISTS idx_labs_nodes_project ON labs_nodes(project_id);

-- ============================================================
-- Labs Edges Table
-- ============================================================

CREATE TABLE IF NOT EXISTS labs_edges (
    id SERIAL PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    edge_id VARCHAR(255) NOT NULL,
    source_node_id VARCHAR(255) NOT NULL,
    target_node_id VARCHAR(255) NOT NULL,
    source_handle VARCHAR(100),
    target_handle VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, edge_id)
);

-- Indexes for labs_edges
CREATE INDEX IF NOT EXISTS idx_labs_edges_project ON labs_edges(project_id);

-- ============================================================
-- Labs AI Templates Table
-- ============================================================

CREATE TABLE IF NOT EXISTS labs_ai_templates (
    id SERIAL PRIMARY KEY,
    mindworkflow_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT,
    system_prompt TEXT,
    user_prompt_example TEXT,
    inputs JSONB DEFAULT '[]',
    settings JSONB DEFAULT '{}',
    routing_config JSONB DEFAULT '{}',
    ai_agent_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Extend AI Operators Table
-- ============================================================

-- Note: AI Operators is a universal_table, not a direct SQL table
-- These columns will be added via the universal table system
-- This is documented here for reference but implemented in the API

-- ALTER TABLE "AI Operators" 
-- ADD COLUMN IF NOT EXISTS integration_key VARCHAR(100),
-- ADD COLUMN IF NOT EXISTS default_model VARCHAR(100),
-- ADD COLUMN IF NOT EXISTS supported_models JSONB DEFAULT '[]',
-- ADD COLUMN IF NOT EXISTS mindworkflow_config JSONB DEFAULT '{}';

-- ============================================================
-- SQLite Compatibility Adjustments
-- ============================================================

-- For SQLite, we need to adjust some syntax
-- SERIAL -> INTEGER PRIMARY KEY AUTOINCREMENT
-- JSONB -> TEXT (JSON stored as text)
-- BOOLEAN -> INTEGER (0/1)
-- NOW() -> datetime('now')

-- Note: The database adapter handles these differences automatically