-- A committed receipt is checked before retained payloads, so a lost successful
-- response can be recovered even after normal payload erasure.
CREATE FUNCTION public.read_payment_gateway_event_recovery(target_event_id uuid,target_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE snapshot record;
BEGIN
  PERFORM private.require_payment_service_role();
  IF target_event_id IS NULL OR target_operation_id IS NULL THEN
    RAISE EXCEPTION 'Recovery requires an event and operation identity' USING ERRCODE='22023';
  END IF;
  SELECT event,receipt.operation_id INTO snapshot
  FROM public.payment_gateway_events event
  LEFT JOIN audit.payment_gateway_event_revalidations receipt ON receipt.gateway_event_id=event.id
  WHERE event.id=target_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
  IF snapshot.operation_id IS NOT NULL THEN
    IF snapshot.operation_id<>target_operation_id THEN RETURN jsonb_build_object('state','conflict'); END IF;
    RETURN jsonb_build_object('state','admitted','processing_status',(snapshot.event).processing_status);
  END IF;
  IF (snapshot.event).processing_status<>'quarantined' THEN
    RETURN jsonb_build_object('state','not_quarantined');
  END IF;
  RETURN jsonb_build_object('state','quarantined','evidence',jsonb_build_object(
    'provider',(snapshot.event).provider,
    'providerAccountScope',(snapshot.event).provider_account_scope,
    'providerEventId',(snapshot.event).provider_event_id,
    'eventType',(snapshot.event).event_type,
    'verificationMethod',(snapshot.event).verification_method,
    'signatureVerifiedAt',(snapshot.event).signature_verified_at,
    'payloadRetentionExpiresAt',(snapshot.event).payload_retention_expires_at,
    'payloadCiphertext',(snapshot.event).payload_ciphertext,
    'payloadSha256',(snapshot.event).payload_sha256,
    'deliveryPayloadSha256',(snapshot.event).redacted_payload->>'delivery_payload_sha256',
    'redactedPayload',(snapshot.event).redacted_payload
  ));
END;
$$;
REVOKE ALL ON FUNCTION public.read_payment_gateway_event_recovery(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_payment_gateway_event_recovery(uuid,uuid) TO service_role;
