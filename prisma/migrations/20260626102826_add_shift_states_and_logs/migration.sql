-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ShiftActionType" AS ENUM ('START', 'PAUSE', 'RESUME', 'END', 'OPTIMIZE');

-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "shiftStatus" "ShiftStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "RouteShiftLog" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "action" "ShiftActionType" NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousSequence" JSONB,
    "newSequence" JSONB,

    CONSTRAINT "RouteShiftLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteShiftLog_routeId_idx" ON "RouteShiftLog"("routeId");

-- CreateIndex
CREATE INDEX "RouteShiftLog_action_idx" ON "RouteShiftLog"("action");

-- CreateIndex
CREATE INDEX "RouteShiftLog_timestamp_idx" ON "RouteShiftLog"("timestamp");

-- AddForeignKey
ALTER TABLE "RouteShiftLog" ADD CONSTRAINT "RouteShiftLog_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
