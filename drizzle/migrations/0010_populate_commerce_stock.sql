-- Quick stock population for demo
-- Run on AGENT database after migration

-- Option 1: Copy from legacy inventory_products (if populated)
INSERT INTO commerce_stock_balances (product_id, business_id, available_qty, reserved_qty, updated_at)
SELECT 
    p.id, 
    p.business_id, 
    COALESCE(p.quantity_on_hand, 0), 
    0,
    now()
FROM inventory_products p
WHERE p.status = 'active'
  AND p.quantity_on_hand > 0
ON CONFLICT (product_id) DO UPDATE SET
    available_qty = GREATEST(EXCLUDED.available_qty, commerce_stock_balances.available_qty),
    updated_at = now();

-- Option 2: Manual set for specific items (replace with your product IDs)
-- UPDATE commerce_stock_balances SET available_qty = 100 WHERE product_id IN ('id1', 'id2', 'id3');

-- Verify
SELECT id, name, available_qty, reserved_qty 
FROM commerce_stock_balances c
JOIN commerce_products p ON p.id = c.product_id
WHERE c.business_id = '6b1d874d-09c6-43f1-8cf0-9efba1d7b74f'
  AND c.available_qty > 0
ORDER BY p.name;