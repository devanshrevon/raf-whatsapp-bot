-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('ACTIVE', 'BOOKED', 'MISSED', 'NEEDS_REVIEW', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('CUSTOMER', 'BOT', 'HUMAN');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'MISSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduledActionType" AS ENUM ('INCOMPLETE_CONVERSATION', 'APPOINTMENT_REMINDER', 'MISSED_CALLBACK');

-- CreateEnum
CREATE TYPE "ScheduledActionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "preferredName" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'ACTIVE',
    "conversationStage" TEXT NOT NULL DEFAULT 'NEW',
    "debtTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimatedDebt" DOUBLE PRECISION,
    "creditorCount" INTEGER,
    "monthlyPayment" DOUBLE PRECISION,
    "region" TEXT,
    "housingStatus" TEXT,
    "employmentStatus" TEXT,
    "dependantSummary" TEXT,
    "motivation" TEXT,
    "paymentArrears" BOOLEAN,
    "bailiffInvolvement" BOOLEAN,
    "courtAction" BOOLEAN,
    "carFinanceConcern" BOOLEAN,
    "recentIncomeLoss" BOOLEAN,
    "relationshipBreakdown" BOOLEAN,
    "businessDebtConcern" BOOLEAN,
    "callbackConsent" BOOLEAN NOT NULL DEFAULT false,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "botPaused" BOOLEAN NOT NULL DEFAULT false,
    "vulnerabilityLevel" INTEGER NOT NULL DEFAULT 0,
    "vulnerabilityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "lastCustomerMessageAt" TIMESTAMP(3),
    "lastBotMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "twilioMessageSid" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "senderType" "SenderType" NOT NULL,
    "body" TEXT NOT NULL,
    "detectedIntent" TEXT,
    "extractedData" JSONB,
    "promptVersion" TEXT,
    "model" TEXT,
    "deliveryStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledAction" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actionType" "ScheduledActionType" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledActionStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduledAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "eventType" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_phoneNumber_key" ON "Lead"("phoneNumber");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_optedOut_idx" ON "Lead"("optedOut");

-- CreateIndex
CREATE UNIQUE INDEX "Message_twilioMessageSid_key" ON "Message"("twilioMessageSid");

-- CreateIndex
CREATE INDEX "Message_leadId_createdAt_idx" ON "Message"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_googleEventId_key" ON "Appointment"("googleEventId");

-- CreateIndex
CREATE INDEX "Appointment_leadId_idx" ON "Appointment"("leadId");

-- CreateIndex
CREATE INDEX "Appointment_startAt_idx" ON "Appointment"("startAt");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "ScheduledAction_status_scheduledAt_idx" ON "ScheduledAction"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ScheduledAction_leadId_idx" ON "ScheduledAction"("leadId");

-- CreateIndex
CREATE INDEX "SystemEvent_leadId_idx" ON "SystemEvent"("leadId");

-- CreateIndex
CREATE INDEX "SystemEvent_eventType_idx" ON "SystemEvent"("eventType");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAction" ADD CONSTRAINT "ScheduledAction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemEvent" ADD CONSTRAINT "SystemEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

