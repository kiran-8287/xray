  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  CREATE TABLE IF NOT EXISTS upload_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_name VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
    item_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255) NOT NULL,
    filepath VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    subcategory VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    upload_session_id UUID REFERENCES upload_sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    pixel_value INTEGER NOT NULL DEFAULT 32767,
    width INTEGER DEFAULT 512,
    height INTEGER DEFAULT 512,
    polygon_json JSONB,
    mask_path VARCHAR(255)
  );

  CREATE TABLE IF NOT EXISTS bags (
    item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    valid_region_points JSONB
  );

  CREATE TABLE IF NOT EXISTS threats (
    item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    threat_type VARCHAR(100),
    severity VARCHAR(50)
  );

  CREATE TABLE IF NOT EXISTS electronics (
    item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    device_type VARCHAR(100)
  );

  CREATE TABLE IF NOT EXISTS clothes (
    item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    garment_type VARCHAR(100)
  );

  CREATE TABLE IF NOT EXISTS trays (
    item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    tray_type VARCHAR(100)
  );

  -- New tables for categorized taxonomy and saved layouts
  CREATE TABLE IF NOT EXISTS categories (
    slug VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50)
  );

  CREATE TABLE IF NOT EXISTS subcategories (
    slug VARCHAR(100) NOT NULL,
    category_slug VARCHAR(100) NOT NULL REFERENCES categories(slug) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    valid_region_points JSONB,
    PRIMARY KEY (category_slug, slug)
  );

  CREATE TABLE IF NOT EXISTS saved_layouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    filepath VARCHAR(1024),
    layout_json JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
