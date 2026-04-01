DELETE FROM "support_ticket_types"
WHERE lower("key") IN ('orderstatus', 'paymentstatus');
