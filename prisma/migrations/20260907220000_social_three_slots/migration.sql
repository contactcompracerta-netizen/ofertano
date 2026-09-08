-- CreateEnum
CREATE TYPE "SocialPostSlot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- AddColumn
ALTER TABLE "SocialPost"
ADD COLUMN "slot" "SocialPostSlot";

-- Existing rows represent the previous single daily post.
-- Preserve them as the MORNING slot.
UPDATE "SocialPost"
SET "slot" = 'MORNING'
WHERE "slot" IS NULL;

-- MakeColumnRequired
ALTER TABLE "SocialPost"
ALTER COLUMN "slot" SET NOT NULL;

-- Replace previous one-post-per-day uniqueness rule.
DROP INDEX "SocialPost_dayKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_dayKey_slot_key"
ON "SocialPost"("dayKey", "slot");
