// Tracker re-exports the shared order-fill repository. Worker layering
// forbids cross-role imports, so executor and tracker both import the
// canonical interface from src/shared/persistence/order-fill/. Phase 6
// spec contemplates an account-keyed fill entity; that lives in the
// shared order-fill schema (provider + accountId + vendorOrderId unique
// index already covers tracker's lookups).
export {
  ORDER_FILL_REPOSITORY as FILL_REPOSITORY,
  type OrderFillRepository as FillRepository,
} from '@shared/persistence/order-fill/order-fill.repository';
