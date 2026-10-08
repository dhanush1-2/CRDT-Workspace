-- AlterTable
ALTER TABLE "DocumentUpdate" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "DocumentUpdate_userId_idx" ON "DocumentUpdate"("userId");

-- AddForeignKey
ALTER TABLE "DocumentUpdate" ADD CONSTRAINT "DocumentUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
