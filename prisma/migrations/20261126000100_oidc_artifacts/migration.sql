-- CreateTable
CREATE TABLE "auth_oidc_artifacts" (
    "model" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "grant_id" TEXT,
    "uid" TEXT,
    "user_code" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_oidc_artifacts_pkey" PRIMARY KEY ("model","id")
);

-- CreateIndex
CREATE INDEX "auth_oidc_artifacts_grant_id_idx" ON "auth_oidc_artifacts"("grant_id");

-- CreateIndex
CREATE INDEX "auth_oidc_artifacts_uid_idx" ON "auth_oidc_artifacts"("uid");

-- CreateIndex
CREATE INDEX "auth_oidc_artifacts_user_code_idx" ON "auth_oidc_artifacts"("user_code");

-- CreateIndex
CREATE INDEX "auth_oidc_artifacts_model_expires_at_idx" ON "auth_oidc_artifacts"("model", "expires_at");

