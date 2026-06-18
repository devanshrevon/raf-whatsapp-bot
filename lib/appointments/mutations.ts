import { db } from "@/lib/db";
import type { AppointmentStatus, Prisma } from "@prisma/client";

export async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
  const appointment = await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } });

  const ops: Prisma.PrismaPromise<unknown>[] = [
    db.appointment.update({ where: { id: appointmentId }, data: { status } })
  ];

  if (status === "MISSED") {
    ops.push(
      db.lead.update({ where: { id: appointment.leadId }, data: { status: "MISSED" } }),
      db.scheduledAction.create({
        data: {
          leadId: appointment.leadId,
          actionType: "MISSED_CALLBACK",
          scheduledAt: new Date(),
          status: "PENDING"
        }
      })
    );
  }

  if (status === "COMPLETED") {
    ops.push(
      db.lead.update({ where: { id: appointment.leadId }, data: { status: "COMPLETED" } }),
      db.scheduledAction.updateMany({
        where: { leadId: appointment.leadId, status: "PENDING" },
        data: { status: "CANCELLED" }
      })
    );
  }

  await db.$transaction(ops);
  await db.systemEvent.create({
    data: { leadId: appointment.leadId, eventType: "appointment_status_changed", detail: { status } }
  });

  return db.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
}
