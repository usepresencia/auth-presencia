-- CreateTable
CREATE TABLE "auth_audit_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "identity_id" UUID,
    "client_id" TEXT,
    "correlation_id" TEXT,
    "reason" TEXT,
    "email_hash" TEXT,
    "address_hash" TEXT,

    CONSTRAINT "auth_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_audit_events_occurred_at_idx" ON "auth_audit_events"("occurred_at");

-- CreateIndex
CREATE INDEX "auth_audit_events_identity_id_occurred_at_idx" ON "auth_audit_events"("identity_id", "occurred_at");
