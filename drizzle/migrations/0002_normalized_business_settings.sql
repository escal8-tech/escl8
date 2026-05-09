CREATE TABLE IF NOT EXISTS business_preferences (
  business_id text PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_preferences_timezone_nonempty
    CHECK (length(btrim(timezone)) > 0)
);

INSERT INTO business_preferences (
  business_id,
  timezone,
  created_at,
  updated_at
)
SELECT
  b.id,
  COALESCE(NULLIF(btrim(b.settings ->> 'timezone'), ''), 'UTC'),
  now(),
  now()
FROM businesses b
ON CONFLICT (business_id) DO UPDATE SET
  timezone = EXCLUDED.timezone,
  updated_at = now();

CREATE TABLE IF NOT EXISTS business_website_widget_settings (
  business_id text PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  widget_key text,
  title text NOT NULL DEFAULT 'Chat with us',
  accent_color text NOT NULL DEFAULT '#2563eb',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_website_widget_key_idx
  ON business_website_widget_settings (widget_key);

INSERT INTO business_website_widget_settings (
  business_id,
  enabled,
  widget_key,
  title,
  accent_color,
  created_at,
  updated_at
)
SELECT
  b.id,
  CASE lower(COALESCE(NULLIF(b.settings #>> '{websiteWidget,enabled}', ''), 'false'))
    WHEN 'true' THEN true
    WHEN '1' THEN true
    WHEN 'yes' THEN true
    ELSE COALESCE(NULLIF(b.settings #>> '{websiteWidget,key}', ''), '') <> ''
  END,
  NULLIF(btrim(COALESCE(b.settings #>> '{websiteWidget,key}', '')), ''),
  COALESCE(NULLIF(b.settings #>> '{websiteWidget,title}', ''), 'Chat with us'),
  COALESCE(NULLIF(b.settings #>> '{websiteWidget,accentColor}', ''), '#2563eb'),
  now(),
  now()
FROM businesses b
WHERE b.settings ? 'websiteWidget'
ON CONFLICT (business_id) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  widget_key = EXCLUDED.widget_key,
  title = EXCLUDED.title,
  accent_color = EXCLUDED.accent_color,
  updated_at = now();

CREATE TABLE IF NOT EXISTS business_order_settings (
  business_id text PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ticket_to_order_enabled boolean NOT NULL DEFAULT true,
  payment_method text NOT NULL DEFAULT 'manual',
  payment_proof_ai_enabled boolean NOT NULL DEFAULT true,
  payment_slip_required boolean NOT NULL DEFAULT true,
  currency text NOT NULL DEFAULT 'LKR',
  delivery_charge_enabled boolean NOT NULL DEFAULT false,
  delivery_charge_type text NOT NULL DEFAULT 'fixed',
  delivery_charge_value text NOT NULL DEFAULT '0',
  bank_qr_show_qr boolean NOT NULL DEFAULT true,
  bank_qr_show_bank_details boolean NOT NULL DEFAULT true,
  bank_qr_blob_path text NOT NULL DEFAULT '',
  bank_qr_image_url text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  account_instructions text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_order_settings_payment_method_valid
    CHECK (payment_method IN ('manual', 'cod', 'bank_qr')),
  CONSTRAINT business_order_settings_delivery_type_valid
    CHECK (delivery_charge_type IN ('fixed', 'percentage')),
  CONSTRAINT business_order_settings_currency_nonempty
    CHECK (length(btrim(currency)) > 0)
);

INSERT INTO business_order_settings (
  business_id,
  ticket_to_order_enabled,
  payment_method,
  payment_proof_ai_enabled,
  payment_slip_required,
  currency,
  delivery_charge_enabled,
  delivery_charge_type,
  delivery_charge_value,
  bank_qr_show_qr,
  bank_qr_show_bank_details,
  bank_qr_blob_path,
  bank_qr_image_url,
  bank_name,
  account_name,
  account_number,
  account_instructions,
  created_at,
  updated_at
)
SELECT
  b.id,
  true,
  CASE
    WHEN lower(COALESCE(NULLIF(b.settings #>> '{orderFlow,paymentMethod}', ''), NULLIF(b.settings #>> '{orders,paymentMethod}', ''))) IN ('cod')
      THEN 'cod'
    WHEN lower(COALESCE(NULLIF(b.settings #>> '{orderFlow,paymentMethod}', ''), NULLIF(b.settings #>> '{orders,paymentMethod}', ''))) IN ('bank_qr', 'bankqr', 'bank/qr')
      THEN 'bank_qr'
    ELSE 'manual'
  END,
  CASE lower(COALESCE(NULLIF(b.settings #>> '{orderFlow,paymentProofAiEnabled}', ''), NULLIF(b.settings #>> '{orders,paymentProofAiEnabled}', ''), 'true'))
    WHEN 'false' THEN false
    WHEN '0' THEN false
    WHEN 'no' THEN false
    ELSE true
  END,
  CASE lower(COALESCE(NULLIF(b.settings #>> '{orderFlow,paymentSlipRequired}', ''), NULLIF(b.settings #>> '{orders,paymentSlipRequired}', ''), 'true'))
    WHEN 'false' THEN false
    WHEN '0' THEN false
    WHEN 'no' THEN false
    ELSE true
  END,
  upper(left(COALESCE(NULLIF(b.settings #>> '{orderFlow,currency}', ''), NULLIF(b.settings #>> '{orders,currency}', ''), 'LKR'), 10)),
  CASE lower(COALESCE(NULLIF(b.settings #>> '{orderFlow,deliveryCharge,enabled}', ''), NULLIF(b.settings #>> '{orders,deliveryCharge,enabled}', ''), 'false'))
    WHEN 'true' THEN true
    WHEN '1' THEN true
    WHEN 'yes' THEN true
    ELSE false
  END,
  CASE
    WHEN lower(COALESCE(NULLIF(b.settings #>> '{orderFlow,deliveryCharge,type}', ''), NULLIF(b.settings #>> '{orders,deliveryCharge,type}', ''))) IN ('percentage', 'percent', '%')
      THEN 'percentage'
    ELSE 'fixed'
  END,
  COALESCE(NULLIF(b.settings #>> '{orderFlow,deliveryCharge,value}', ''), NULLIF(b.settings #>> '{orderFlow,deliveryCharge,amount}', ''), NULLIF(b.settings #>> '{orders,deliveryCharge,value}', ''), '0'),
  CASE lower(COALESCE(NULLIF(b.settings #>> '{orderFlow,bankQr,showQr}', ''), NULLIF(b.settings #>> '{orders,bankQr,showQr}', ''), 'true'))
    WHEN 'false' THEN false
    WHEN '0' THEN false
    WHEN 'no' THEN false
    ELSE true
  END,
  CASE lower(COALESCE(NULLIF(b.settings #>> '{orderFlow,bankQr,showBankDetails}', ''), NULLIF(b.settings #>> '{orders,bankQr,showBankDetails}', ''), 'true'))
    WHEN 'false' THEN false
    WHEN '0' THEN false
    WHEN 'no' THEN false
    ELSE true
  END,
  COALESCE(NULLIF(b.settings #>> '{orderFlow,bankQr,qrBlobPath}', ''), NULLIF(b.settings #>> '{orders,bankQr,qrBlobPath}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{orderFlow,bankQr,qrImageUrl}', ''), NULLIF(b.settings #>> '{orders,bankQr,qrImageUrl}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{orderFlow,bankQr,bankName}', ''), NULLIF(b.settings #>> '{orders,bankQr,bankName}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{orderFlow,bankQr,accountName}', ''), NULLIF(b.settings #>> '{orders,bankQr,accountName}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{orderFlow,bankQr,accountNumber}', ''), NULLIF(b.settings #>> '{orders,bankQr,accountNumber}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{orderFlow,bankQr,accountInstructions}', ''), NULLIF(b.settings #>> '{orders,bankQr,accountInstructions}', ''), ''),
  now(),
  now()
FROM businesses b
ON CONFLICT (business_id) DO UPDATE SET
  ticket_to_order_enabled = EXCLUDED.ticket_to_order_enabled,
  payment_method = EXCLUDED.payment_method,
  payment_proof_ai_enabled = EXCLUDED.payment_proof_ai_enabled,
  payment_slip_required = EXCLUDED.payment_slip_required,
  currency = EXCLUDED.currency,
  delivery_charge_enabled = EXCLUDED.delivery_charge_enabled,
  delivery_charge_type = EXCLUDED.delivery_charge_type,
  delivery_charge_value = EXCLUDED.delivery_charge_value,
  bank_qr_show_qr = EXCLUDED.bank_qr_show_qr,
  bank_qr_show_bank_details = EXCLUDED.bank_qr_show_bank_details,
  bank_qr_blob_path = EXCLUDED.bank_qr_blob_path,
  bank_qr_image_url = EXCLUDED.bank_qr_image_url,
  bank_name = EXCLUDED.bank_name,
  account_name = EXCLUDED.account_name,
  account_number = EXCLUDED.account_number,
  account_instructions = EXCLUDED.account_instructions,
  updated_at = now();

CREATE TABLE IF NOT EXISTS business_customization_settings (
  business_id text PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
  business_name text NOT NULL DEFAULT '',
  logo_blob_path text NOT NULL DEFAULT '',
  logo_container text NOT NULL DEFAULT '',
  logo_url text NOT NULL DEFAULT '',
  primary_color text NOT NULL DEFAULT '#0E1B40',
  secondary_color text NOT NULL DEFAULT '#D4A457',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  invoice_footer_note text NOT NULL DEFAULT 'Please keep this invoice for your records.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO business_customization_settings (
  business_id,
  business_name,
  logo_blob_path,
  logo_container,
  logo_url,
  primary_color,
  secondary_color,
  address,
  phone,
  email,
  website,
  invoice_footer_note,
  created_at,
  updated_at
)
SELECT
  b.id,
  COALESCE(NULLIF(b.settings #>> '{customization,businessName}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{customization,logoBlobPath}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{customization,logoContainer}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{customization,logoUrl}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{customization,primaryColor}', ''), '#0E1B40'),
  COALESCE(NULLIF(b.settings #>> '{customization,secondaryColor}', ''), '#D4A457'),
  COALESCE(NULLIF(b.settings #>> '{customization,address}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{customization,phone}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{customization,email}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{customization,website}', ''), ''),
  COALESCE(NULLIF(b.settings #>> '{customization,invoiceFooterNote}', ''), 'Please keep this invoice for your records.'),
  now(),
  now()
FROM businesses b
ON CONFLICT (business_id) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  logo_blob_path = EXCLUDED.logo_blob_path,
  logo_container = EXCLUDED.logo_container,
  logo_url = EXCLUDED.logo_url,
  primary_color = EXCLUDED.primary_color,
  secondary_color = EXCLUDED.secondary_color,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  website = EXCLUDED.website,
  invoice_footer_note = EXCLUDED.invoice_footer_note,
  updated_at = now();
