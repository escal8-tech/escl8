-- Azure Postgres already exposes gen_random_uuid(); creating pgcrypto is not
-- allow-listed for the app database user.

CREATE TABLE IF NOT EXISTS commerce_settings (
  business_id text PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  suite_tenant_id text,
  items_enabled boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'LKR',
  column_mapping jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commerce_settings_suite_tenant_idx
  ON commerce_settings (suite_tenant_id);

CREATE TABLE IF NOT EXISTS commerce_import_batches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  suite_tenant_id text,
  source text NOT NULL DEFAULT 'shared_commerce',
  file_name text,
  file_type text,
  row_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  column_mapping jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commerce_import_batches_business_created_idx
  ON commerce_import_batches (business_id, created_at);
CREATE INDEX IF NOT EXISTS commerce_import_batches_suite_tenant_idx
  ON commerce_import_batches (suite_tenant_id, created_at);

CREATE TABLE IF NOT EXISTS commerce_products (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  suite_tenant_id text,
  source text NOT NULL DEFAULT 'shared_commerce',
  source_filename text,
  source_sheet text NOT NULL DEFAULT '',
  source_row_number integer NOT NULL DEFAULT 0,
  source_row_key text NOT NULL,
  sku text,
  name text NOT NULL,
  description text,
  specification text,
  category text,
  brand text,
  model text,
  unit text,
  image_url text,
  document_url text,
  base_price_minor integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'LKR',
  status text NOT NULL DEFAULT 'active',
  public_visibility text NOT NULL DEFAULT 'hidden',
  raw_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_text text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_products_status_valid CHECK (status IN ('active', 'archived', 'draft')),
  CONSTRAINT commerce_products_visibility_valid CHECK (public_visibility IN ('hidden', 'public', 'private')),
  CONSTRAINT commerce_products_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT commerce_products_source_row_key_nonempty CHECK (length(btrim(source_row_key)) > 0)
);

CREATE INDEX IF NOT EXISTS commerce_products_business_id_idx
  ON commerce_products (business_id);
CREATE INDEX IF NOT EXISTS commerce_products_suite_tenant_status_idx
  ON commerce_products (suite_tenant_id, status);
CREATE INDEX IF NOT EXISTS commerce_products_business_status_idx
  ON commerce_products (business_id, status);
CREATE INDEX IF NOT EXISTS commerce_products_business_sku_idx
  ON commerce_products (business_id, sku);
CREATE INDEX IF NOT EXISTS commerce_products_business_name_idx
  ON commerce_products (business_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_products_business_source_row_ux
  ON commerce_products (business_id, source_row_key);

CREATE TABLE IF NOT EXISTS commerce_product_prices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  product_id text NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE ON UPDATE CASCADE,
  source_key text NOT NULL,
  label text NOT NULL,
  value_text text NOT NULL,
  amount_minor integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'LKR',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_product_prices_label_nonempty CHECK (length(btrim(label)) > 0)
);

CREATE INDEX IF NOT EXISTS commerce_product_prices_business_id_idx
  ON commerce_product_prices (business_id);
CREATE INDEX IF NOT EXISTS commerce_product_prices_product_id_idx
  ON commerce_product_prices (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_product_prices_product_source_ux
  ON commerce_product_prices (product_id, source_key);

CREATE TABLE IF NOT EXISTS commerce_stock_balances (
  product_id text PRIMARY KEY REFERENCES commerce_products(id) ON DELETE CASCADE ON UPDATE CASCADE,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  available_qty integer NOT NULL DEFAULT 0,
  reserved_qty integer NOT NULL DEFAULT 0,
  last_movement_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_stock_balances_available_nonnegative CHECK (available_qty >= 0),
  CONSTRAINT commerce_stock_balances_reserved_nonnegative CHECK (reserved_qty >= 0)
);

CREATE INDEX IF NOT EXISTS commerce_stock_balances_business_qty_idx
  ON commerce_stock_balances (business_id, available_qty);

CREATE TABLE IF NOT EXISTS commerce_orders (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  suite_tenant_id text,
  order_number text NOT NULL,
  channel text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'draft',
  payment_status text NOT NULL DEFAULT 'unpaid',
  stock_status text NOT NULL DEFAULT 'not_reserved',
  customer_name text,
  customer_phone text,
  customer_email text,
  currency text NOT NULL DEFAULT 'LKR',
  subtotal_minor integer NOT NULL DEFAULT 0,
  discount_minor integer NOT NULL DEFAULT 0,
  total_minor integer NOT NULL DEFAULT 0,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  completed_by_user_id text REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_business_order_number_ux
  ON commerce_orders (business_id, order_number);
CREATE INDEX IF NOT EXISTS commerce_orders_business_created_idx
  ON commerce_orders (business_id, created_at);
CREATE INDEX IF NOT EXISTS commerce_orders_business_status_idx
  ON commerce_orders (business_id, status);
CREATE INDEX IF NOT EXISTS commerce_orders_suite_tenant_created_idx
  ON commerce_orders (suite_tenant_id, created_at);

CREATE TABLE IF NOT EXISTS commerce_order_lines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  order_id text NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
  product_id text REFERENCES commerce_products(id) ON DELETE SET NULL ON UPDATE CASCADE,
  price_id text REFERENCES commerce_product_prices(id) ON DELETE SET NULL ON UPDATE CASCADE,
  item_type text NOT NULL DEFAULT 'product',
  item_name text NOT NULL,
  sku text,
  quantity integer NOT NULL,
  unit_price_minor integer NOT NULL DEFAULT 0,
  line_total_minor integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'LKR',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_order_lines_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS commerce_order_lines_business_order_idx
  ON commerce_order_lines (business_id, order_id);
CREATE INDEX IF NOT EXISTS commerce_order_lines_business_product_idx
  ON commerce_order_lines (business_id, product_id);

CREATE TABLE IF NOT EXISTS commerce_order_payments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  order_id text NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
  payment_method text NOT NULL DEFAULT 'bank_qr',
  status text NOT NULL DEFAULT 'pending',
  currency text NOT NULL DEFAULT 'LKR',
  expected_amount_minor integer NOT NULL DEFAULT 0,
  paid_amount_minor integer NOT NULL DEFAULT 0,
  paid_date text,
  reference_code text,
  bank_reference_code text,
  proof_url text,
  ai_check_status text,
  ai_check_notes text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commerce_order_payments_business_order_idx
  ON commerce_order_payments (business_id, order_id);
CREATE INDEX IF NOT EXISTS commerce_order_payments_bank_reference_idx
  ON commerce_order_payments (business_id, bank_reference_code, paid_amount_minor);

CREATE TABLE IF NOT EXISTS commerce_stock_reservations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  order_id text NOT NULL,
  order_line_id text,
  product_id text NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE ON UPDATE CASCADE,
  quantity integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  reason text,
  expires_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_stock_reservations_status_valid CHECK (status IN ('active', 'consumed', 'released', 'expired')),
  CONSTRAINT commerce_stock_reservations_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS commerce_stock_reservations_business_status_idx
  ON commerce_stock_reservations (business_id, status);
CREATE INDEX IF NOT EXISTS commerce_stock_reservations_business_order_idx
  ON commerce_stock_reservations (business_id, order_id);
CREATE INDEX IF NOT EXISTS commerce_stock_reservations_product_idx
  ON commerce_stock_reservations (product_id);

CREATE TABLE IF NOT EXISTS commerce_stock_movements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  suite_tenant_id text,
  product_id text NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE ON UPDATE CASCADE,
  order_id text,
  movement_type text NOT NULL,
  quantity_delta integer NOT NULL,
  balance_after integer,
  source_ref_type text,
  source_ref_id text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commerce_stock_movements_business_created_idx
  ON commerce_stock_movements (business_id, created_at);
CREATE INDEX IF NOT EXISTS commerce_stock_movements_product_created_idx
  ON commerce_stock_movements (product_id, created_at);
CREATE INDEX IF NOT EXISTS commerce_stock_movements_source_idx
  ON commerce_stock_movements (source_ref_type, source_ref_id);

CREATE TABLE IF NOT EXISTS commerce_import_rows (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_id text NOT NULL REFERENCES commerce_import_batches(id) ON DELETE CASCADE ON UPDATE CASCADE,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  row_number integer NOT NULL,
  source_row_key text NOT NULL,
  product_id text REFERENCES commerce_products(id) ON DELETE SET NULL ON UPDATE CASCADE,
  raw_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'imported',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_import_rows_batch_row_ux
  ON commerce_import_rows (batch_id, row_number);
CREATE INDEX IF NOT EXISTS commerce_import_rows_business_batch_idx
  ON commerce_import_rows (business_id, batch_id);
CREATE INDEX IF NOT EXISTS commerce_import_rows_business_source_idx
  ON commerce_import_rows (business_id, source_row_key);

CREATE TABLE IF NOT EXISTS commerce_offers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  suite_tenant_id text,
  product_id text NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE ON UPDATE CASCADE,
  title text NOT NULL DEFAULT 'Offer',
  description text,
  original_price_minor integer,
  offer_price_minor integer NOT NULL,
  currency text NOT NULL DEFAULT 'LKR',
  active boolean NOT NULL DEFAULT true,
  public_visible boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commerce_offers_business_active_idx
  ON commerce_offers (business_id, active);
CREATE INDEX IF NOT EXISTS commerce_offers_product_idx
  ON commerce_offers (product_id);

CREATE TABLE IF NOT EXISTS commerce_customer_profiles (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  suite_tenant_id text,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  name text,
  phone text,
  email text,
  lifetime_spend_minor integer NOT NULL DEFAULT 0,
  order_count integer NOT NULL DEFAULT 0,
  loyalty_points integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commerce_customer_profiles_business_phone_idx
  ON commerce_customer_profiles (business_id, phone);
CREATE INDEX IF NOT EXISTS commerce_customer_profiles_business_email_idx
  ON commerce_customer_profiles (business_id, email);
CREATE INDEX IF NOT EXISTS commerce_customer_profiles_customer_id_idx
  ON commerce_customer_profiles (customer_id);

CREATE TABLE IF NOT EXISTS commerce_loyalty_ledger (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  profile_id text NOT NULL REFERENCES commerce_customer_profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  order_id text REFERENCES commerce_orders(id) ON DELETE SET NULL ON UPDATE CASCADE,
  points_delta integer NOT NULL,
  reason text NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commerce_loyalty_ledger_business_profile_idx
  ON commerce_loyalty_ledger (business_id, profile_id);
CREATE INDEX IF NOT EXISTS commerce_loyalty_ledger_order_idx
  ON commerce_loyalty_ledger (order_id);

CREATE TABLE IF NOT EXISTS commerce_membership_plans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  suite_tenant_id text,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'LKR',
  price_minor integer NOT NULL DEFAULT 0,
  billing_mode text NOT NULL DEFAULT 'manual',
  benefit_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_membership_plans_name_nonempty CHECK (length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS commerce_membership_plans_business_status_idx
  ON commerce_membership_plans (business_id, status);

CREATE TABLE IF NOT EXISTS commerce_memberships (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  profile_id text NOT NULL REFERENCES commerce_customer_profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  plan_id text NOT NULL REFERENCES commerce_membership_plans(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status text NOT NULL DEFAULT 'active',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  source_order_id text REFERENCES commerce_orders(id) ON DELETE SET NULL ON UPDATE CASCADE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_memberships_status_valid CHECK (status IN ('active', 'paused', 'cancelled', 'expired'))
);

CREATE INDEX IF NOT EXISTS commerce_memberships_business_profile_idx
  ON commerce_memberships (business_id, profile_id);
CREATE INDEX IF NOT EXISTS commerce_memberships_plan_idx
  ON commerce_memberships (plan_id);

INSERT INTO commerce_settings (
  business_id,
  suite_tenant_id,
  items_enabled,
  currency,
  column_mapping,
  metadata,
  created_at,
  updated_at
)
SELECT
  b.id,
  b.suite_tenant_id,
  false,
  'LKR',
  COALESCE(b.settings #> '{stock,columnMapping}', '[]'::jsonb),
  jsonb_build_object('migratedFrom', 'inventory_products'),
  now(),
  now()
FROM businesses b
WHERE EXISTS (
  SELECT 1
  FROM inventory_products p
  WHERE p.business_id = b.id
)
ON CONFLICT (business_id) DO UPDATE SET
  suite_tenant_id = COALESCE(commerce_settings.suite_tenant_id, EXCLUDED.suite_tenant_id),
  column_mapping = CASE
    WHEN commerce_settings.column_mapping = '[]'::jsonb THEN EXCLUDED.column_mapping
    ELSE commerce_settings.column_mapping
  END,
  updated_at = now();

INSERT INTO commerce_products (
  id,
  business_id,
  suite_tenant_id,
  source,
  source_filename,
  source_sheet,
  source_row_number,
  source_row_key,
  sku,
  name,
  description,
  specification,
  category,
  brand,
  model,
  unit,
  image_url,
  document_url,
  base_price_minor,
  currency,
  status,
  public_visibility,
  raw_fields,
  search_text,
  metadata,
  last_imported_at,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.business_id,
  b.suite_tenant_id,
  p.source,
  p.source_filename,
  p.source_sheet,
  p.source_row_number,
  p.source_row_key,
  p.item_code,
  p.name,
  p.description,
  p.specification,
  p.category,
  p.brand,
  p.model,
  p.quantity_unit,
  CASE WHEN p.media_type = 'image' THEN p.media_url ELSE NULL END,
  CASE WHEN p.media_type = 'document' THEN p.media_url ELSE NULL END,
  COALESCE((
    SELECT GREATEST(0, ROUND(COALESCE(po.amount, 0) * 100)::int)
    FROM inventory_product_price_options po
    WHERE po.product_id = p.id
      AND po.business_id = p.business_id
      AND po.amount IS NOT NULL
    ORDER BY po.sort_order, po.label
    LIMIT 1
  ), 0),
  'LKR',
  p.status,
  'public',
  COALESCE(p.raw_fields, '{}'::jsonb),
  COALESCE(p.search_text, ''),
  jsonb_build_object('migratedFrom', 'inventory_products'),
  p.indexed_at,
  p.created_at,
  p.updated_at
FROM inventory_products p
JOIN businesses b ON b.id = p.business_id
ON CONFLICT (business_id, source_row_key) DO UPDATE SET
  sku = EXCLUDED.sku,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  specification = EXCLUDED.specification,
  category = EXCLUDED.category,
  brand = EXCLUDED.brand,
  model = EXCLUDED.model,
  unit = EXCLUDED.unit,
  image_url = EXCLUDED.image_url,
  document_url = EXCLUDED.document_url,
  base_price_minor = EXCLUDED.base_price_minor,
  currency = EXCLUDED.currency,
  status = EXCLUDED.status,
  public_visibility = EXCLUDED.public_visibility,
  raw_fields = EXCLUDED.raw_fields,
  search_text = EXCLUDED.search_text,
  last_imported_at = EXCLUDED.last_imported_at,
  updated_at = now();

INSERT INTO commerce_product_prices (
  id,
  business_id,
  product_id,
  source_key,
  label,
  value_text,
  amount_minor,
  currency,
  sort_order,
  created_at,
  updated_at
)
SELECT
  po.id,
  po.business_id,
  po.product_id,
  po.source_key,
  po.label,
  po.value_text,
  GREATEST(0, ROUND(COALESCE(po.amount, 0) * 100)::int),
  po.currency,
  po.sort_order,
  po.created_at,
  po.updated_at
FROM inventory_product_price_options po
JOIN commerce_products cp ON cp.id = po.product_id
ON CONFLICT (product_id, source_key) DO UPDATE SET
  label = EXCLUDED.label,
  value_text = EXCLUDED.value_text,
  amount_minor = EXCLUDED.amount_minor,
  currency = EXCLUDED.currency,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO commerce_stock_balances (
  product_id,
  business_id,
  available_qty,
  reserved_qty,
  last_movement_at,
  updated_at
)
SELECT
  p.id,
  p.business_id,
  GREATEST(0, COALESCE(p.quantity_on_hand, 0) - COALESCE(r.reserved_qty, 0)),
  COALESCE(r.reserved_qty, 0),
  now(),
  now()
FROM inventory_products p
LEFT JOIN (
  SELECT business_id, product_id, COALESCE(SUM(quantity), 0)::int AS reserved_qty
  FROM inventory_reservations
  WHERE status = 'held'
    AND expires_at > now()
  GROUP BY business_id, product_id
) r ON r.business_id = p.business_id AND r.product_id = p.id
JOIN commerce_products cp ON cp.id = p.id
WHERE p.quantity_on_hand IS NOT NULL
ON CONFLICT (product_id) DO UPDATE SET
  available_qty = EXCLUDED.available_qty,
  reserved_qty = EXCLUDED.reserved_qty,
  last_movement_at = EXCLUDED.last_movement_at,
  updated_at = now();

INSERT INTO commerce_offers (
  id,
  business_id,
  suite_tenant_id,
  product_id,
  title,
  description,
  original_price_minor,
  offer_price_minor,
  currency,
  active,
  public_visible,
  starts_at,
  ends_at,
  metadata,
  created_at,
  updated_at
)
SELECT
  o.id,
  o.business_id,
  b.suite_tenant_id,
  o.product_id,
  o.title,
  o.notes,
  CASE WHEN o.original_price_amount IS NULL THEN NULL ELSE GREATEST(0, ROUND(o.original_price_amount * 100)::int) END,
  GREATEST(0, ROUND(COALESCE(o.offer_price_amount, 0) * 100)::int),
  o.currency,
  o.is_active,
  true,
  o.starts_at,
  o.ends_at,
  jsonb_build_object(
    'migratedFrom', 'inventory_product_offers',
    'originalPriceText', o.original_price_text,
    'offerPriceText', o.offer_price_text
  ),
  o.created_at,
  o.updated_at
FROM inventory_product_offers o
JOIN businesses b ON b.id = o.business_id
JOIN commerce_products cp ON cp.id = o.product_id
WHERE o.offer_price_amount IS NOT NULL
ON CONFLICT (id) DO NOTHING;
