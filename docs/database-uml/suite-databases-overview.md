# Escal8 Databases UML

This document is generated from the Drizzle schema artifacts. It is organized as three isolated database areas with explicit logical links between them.

## Areas

### Control Plane Database

Suite tenancy, users, memberships, entitlements, and cross-app links.

- Schema hash: 10e184a8373e95a9
- Tables: 5
- Foreign-key relationships: 4

- suite_app_links: 10 columns, PK id
- suite_entitlements: 8 columns, PK suite_tenant_id, module
- suite_memberships: 6 columns, PK suite_tenant_id, suite_user_id
- suite_tenants: 6 columns, PK id
- suite_users: 7 columns, PK id

### Agent Database

WhatsApp identities, agent customers, conversations, requests, tickets, orders, inventory, RAG, and usage.

- Schema hash: dab4ab662ea713a1
- Tables: 21
- Foreign-key relationships: 43

- ai_usage_events: 10 columns, PK id
- bookings: 11 columns, PK id
- businesses: 24 columns, PK id
- customers: 26 columns, PK id
- inventory_product_price_options: 11 columns, PK id
- inventory_products: 24 columns, PK id
- message_outbox: 22 columns, PK id
- message_threads: 10 columns, PK id
- operation_throttles: 7 columns, PK scope_key
- order_events: 9 columns, PK id
- order_payments: 19 columns, PK id
- orders: 55 columns, PK id
- rag_jobs: 10 columns, PK id
- requests: 16 columns, PK id
- support_ticket_events: 9 columns, PK id
- support_ticket_types: 9 columns, PK id
- support_tickets: 26 columns, PK id
- thread_messages: 8 columns, PK id
- training_documents: 15 columns, PK id
- users: 8 columns, PK id
- whatsapp_identities: 19 columns, PK phone_number_id

### Reservation Database

Venues, staff, rooms/resources, guests, reservations, payments, waitlist, and auth.

- Schema hash: a02dd156fabce74d
- Tables: 12
- Foreign-key relationships: 20

- accounts: 11 columns, PK provider, provider_account_id
- api_idempotency_keys: 9 columns, PK id
- furniture: 14 columns, PK id
- guests: 15 columns, PK id
- hotels: 46 columns, PK id
- payment_transactions: 18 columns, PK id
- reservations: 36 columns, PK id
- rooms: 9 columns, PK id
- sessions: 3 columns, PK session_token
- users: 24 columns, PK id
- verification_tokens: 3 columns, PK identifier, token
- waitlist: 19 columns, PK id

## Cross-Database Logical Links

- Control Plane Database: suite_tenants.id -> Agent Database: businesses.suite_tenant_id (tenant ownership)
- Control Plane Database: suite_tenants.id -> Reservation Database: hotels.suite_tenant_id (tenant ownership)
- Control Plane Database: suite_users.id -> Agent Database: users.suite_user_id (suite user identity)
- Control Plane Database: suite_users.id -> Reservation Database: users.suite_user_id (suite user identity)
- Agent Database: businesses.id -> Reservation Database: hotels.business_id (agent business attached to venue)
- Agent Database: whatsapp_identities.phone_number_id -> Reservation Database: hotels.whatsapp_phone_number_id (venue WhatsApp sender)
- Agent Database: whatsapp_identities.phone_number_id -> Reservation Database: hotels.business_default_whatsapp_phone_number_id (default WhatsApp sender)
- Control Plane Database: suite_app_links.source_entity_id / target_entity_id -> agent + reservation: module entity ids (generic cross-app record links)
