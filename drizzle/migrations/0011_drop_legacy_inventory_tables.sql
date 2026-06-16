-- Migration V11: Drop legacy inventory tables (no longer used)
-- Run on AGENT database

-- Drop inventory_reservations table (referenced in auto_orders.py, product_catalog.py)
DROP TABLE IF EXISTS inventory_reservations CASCADE;

-- Drop inventory_product_price_options table
DROP TABLE IF EXISTS inventory_product_price_options CASCADE;

-- Drop inventory_products table (legacy inventory system)
DROP TABLE IF EXISTS inventory_products CASCADE;

-- Drop inventory_product_offers table if exists
DROP TABLE IF EXISTS inventory_product_offers CASCADE;

-- Drop inventory_training_documents if exists
DROP TABLE IF EXISTS inventory_training_documents CASCADE;