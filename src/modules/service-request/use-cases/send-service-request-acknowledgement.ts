import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendTransactionalEmail } from "@/src/integrations/email/mailer";
import { serviceRequestAcknowledgementEmail } from "@/src/integrations/email/templates";
import { sendTransactionalSms } from "@/src/integrations/sms/termii";
import type { ServiceRequestRecord } from "@/src/modules/service-request/types";

const SERVICE_LABELS: Record<ServiceRequestRecord["serviceType"], string> = {
  CONSULTATION: "Solar consultation",
  SYSTEM_SIZING: "System sizing",
  INSTALLATION: "Solar installation",
  MAINTENANCE: "Solar maintenance",
  SITE_ASSESSMENT: "Site assessment",
};

export async function sendServiceRequestAcknowledgement(
  request: ServiceRequestRecord,
): Promise<void> {
  const serviceLabel = SERVICE_LABELS[request.serviceType];
  const trackingPath = request.userId
    ? "/account/service-requests"
    : `/service-request-submitted?id=${encodeURIComponent(request.id)}`;
  const trackingUrl = new URL(trackingPath, env.APP_BASE_URL).href;
  const deliveries: Promise<unknown>[] = [];

  if (request.requesterEmail) {
    deliveries.push(
      sendTransactionalEmail({
        to: request.requesterEmail,
        ...serviceRequestAcknowledgementEmail({
          name: request.requesterName,
          reference: request.id,
          serviceLabel,
          trackingUrl,
        }),
      }).catch((error) => {
        logger.error(
          { err: error, serviceRequestId: request.id, channel: "email" },
          "Service request acknowledgement delivery failed",
        );
      }),
    );
  }

  if (request.requesterPhone) {
    deliveries.push(
      sendTransactionalSms({
        to: request.requesterPhone,
        message: `Watplux: We received your ${serviceLabel.toLowerCase()} request #${request.id}. Our team will review it and contact you with the next step.`,
      }).catch((error) => {
        logger.error(
          { err: error, serviceRequestId: request.id, channel: "sms" },
          "Service request acknowledgement delivery failed",
        );
      }),
    );
  }

  await Promise.all(deliveries);
}
