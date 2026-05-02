// Public surface of `@originchain/sdk`.
//
// Two clients:
//   * `OriginChainClient`      — talks to a per-tenant engine (bearer auth)
//   * `OriginChainAdminClient` — talks to the control plane (cookie + bearer)

export {
  OriginChainClient,
  OriginChainAdminClient,
  GraphMethods,
  tenantIdFromEndpoint,
} from "./client.js";

export {
  ApiError,
  OCAddonRequiredError,
  OCPaymentRequiredError,
  isAddonRequiredBody,
} from "./errors.js";

export type { ApiErrorBody, AddonRequiredBody } from "./errors.js";

export type {
  AddonEnableResponse,
  AddonRow,
  AdminClientOptions,
  AskRequest,
  AskResponse,
  AuthResponse,
  CardSummary,
  ClientOptions,
  ConfirmPaymentBody,
  ConfirmPaymentMethodBody,
  DijkstraResult,
  Eligibility,
  EventView,
  FetchLike,
  FtsIndexDoc,
  FtsMode,
  GraphBfsHit,
  GraphPath,
  Instance,
  LogLine,
  LogsResponse,
  MetricPoint,
  MetricSeries,
  MetricsResponse,
  PaymentMethodView,
  PendingPaymentResponse,
  Plan,
  PlansResponse,
  ProvisionResponse,
  RankedHit,
  RemoveBlockedBody,
  SetupIntent,
  SnapshotView,
  SqlDelete,
  SqlInsert,
  SqlReq,
  SqlResp,
  SqlSelect,
  Subscription,
  User,
  VecHit,
  VecMetric,
  VecPutReq,
  VecTopkReq,
} from "./types.js";
