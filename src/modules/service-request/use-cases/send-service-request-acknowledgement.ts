import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendTransactionalEmail } from "@/src/integrations/email/mailer";
import { serviceRequestAcknowledgementEmail } from "@/src/integrations/email/templates";
import { sendTransactionalSms } from "@/src/integrations/sms/termii";
import type { ServiceRequestRecord } from "@/src/modules/service-request/types";
import {
  fillCopy,
  loadCopyNamespace,
} from "@/src/modules/site-copy/public-copy";

export async function sendServiceRequestAcknowledgement(
  request: ServiceRequestRecord,
): Promise<void> {
  const [copy, siteCopy] = await Promise.all([
    loadCopyNamespace("email"),
    loadCopyNamespace("site"),
  ]);
  const serviceLabels: Record<ServiceRequestRecord["serviceType"], string> = {
    CONSULTATION: copy("email.service.consultation"),
    SYSTEM_SIZING: copy("email.service.sizing"),
    INSTALLATION: copy("email.service.installation"),
    MAINTENANCE: copy("email.service.maintenance"),
    SITE_ASSESSMENT: copy("email.service.assessment"),
  };
  const serviceLabel = serviceLabels[request.serviceType];
  const trackingPath = request.userId
    ? "/account/service-requests"
    : `/service-request-submitted?id=${encodeURIComponent(request.id)}`;
  const trackingUrl = new URL(trackingPath, env.APP_BASE_URL).href;
  const deliveries: Promise<unknown>[] = [];

  if (request.requesterEmail) {
    deliveries.push(
      serviceRequestAcknowledgementEmail({
        name: request.requesterName,
        reference: request.id,
        serviceLabel,
        trackingUrl,
      })
        .then((message) =>
          sendTransactionalEmail({ to: request.requesterEmail!, ...message }),
        )
        .catch((error) => {
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
        message: fillCopy(copy("email.service.sms"), {
          siteName: siteCopy("site.name"),
          serviceLabel: serviceLabel.toLowerCase(),
          reference: request.id,
        }),
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
