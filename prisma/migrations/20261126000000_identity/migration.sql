-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "email" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_firebase_identities" (
    "firebase_project_id" TEXT NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "identity_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_firebase_identities_pkey" PRIMARY KEY ("firebase_project_id","firebase_uid")
);

-- CreateIndex
CREATE INDEX "auth_firebase_identities_identity_idx" ON "auth_firebase_identities"("identity_id");

-- AddForeignKey
ALTER TABLE "auth_firebase_identities" ADD CONSTRAINT "auth_firebase_identities_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "auth_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restrições que o schema do Prisma não expressa.
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_status_check"
    CHECK ("status" IN ('active', 'disabled'));
ALTER TABLE "auth_firebase_identities" ADD CONSTRAINT "auth_firebase_identities_project_check"
    CHECK (char_length("firebase_project_id") BETWEEN 1 AND 128);
ALTER TABLE "auth_firebase_identities" ADD CONSTRAINT "auth_firebase_identities_uid_check"
    CHECK (char_length("firebase_uid") BETWEEN 1 AND 128);
