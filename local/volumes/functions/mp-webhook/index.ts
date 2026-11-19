/** Confirms Mercado Pago Checkout Pro Orders and grants the purchased period. */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type WebhookBody = { type?: string; action?: string; application_id?: string | number; live_mode?: boolean; data?: { id?: string | number } };

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function isValidSignature(signatureHeader: string | null, requestId: string | null, dataId: string | null, secret: string): Promise<boolean> {
  const normalizedSignature = signatureHeader?.trim();
  const normalizedRequestId = requestId || null;
  // Mercado Pago requires alphanumeric data.id values to be lowercased in the
  // HMAC manifest. The original ID is still used for the API lookup below.
  const normalizedDataId = dataId ? dataId.toLowerCase() : null;
  if (!normalizedSignature || !normalizedDataId) return false;

  const signatureParts: Record<string, string> = {};
  for (const part of normalizedSignature.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (name && value) signatureParts[name] = value;
  }
  const timestamp = signatureParts.ts;
  const receivedHash = signatureParts.v1?.toLowerCase();
  if (!timestamp || !/^\d+$/.test(timestamp) || !receivedHash) return false;

  const manifest = [
    normalizedDataId ? `id:${normalizedDataId}` : null,
    normalizedRequestId ? `request-id:${normalizedRequestId}` : null,
    `ts:${timestamp}`,
  ].filter((part): part is string => part !== null).join(";") + ";";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest))));
  if (expected.length !== receivedHash.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) mismatch |= expected.charCodeAt(index) ^ receivedHash.charCodeAt(index);
  return mismatch === 0;
}

async function diagnoseSignature(
  signatureHeader: string | null,
  requestId: string | null,
  queryDataId: string | null,
  bodyDataId: string | null,
  secrets: Array<[string, string | undefined]>,
): Promise<{ matchingSecrets: string[]; matchingManifests: string[] }> {
  const parts = Object.fromEntries((signatureHeader ?? "").split(",").map((part) => {
    const separator = part.indexOf("=");
    return separator < 0 ? ["", ""] : [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()];
  }));
  const timestamp = parts.ts;
  const receivedHash = parts.v1?.toLowerCase();
  if (!timestamp || !/^\d+$/.test(timestamp) || !receivedHash) {
    return { matchingSecrets: [], matchingManifests: [] };
  }

  const ids = new Map<string, string>();
  if (queryDataId) {
    ids.set("query_lower", queryDataId.toLowerCase());
    ids.set("query_original", queryDataId);
  }
  if (bodyDataId) {
    ids.set("body_lower", bodyDataId.toLowerCase());
    ids.set("body_original", bodyDataId);
  }
  const requestIds = new Map<string, string | null>([
    ["request_exact", requestId],
    ["request_trimmed", requestId?.trim() || null],
    ["request_omitted", null],
  ]);
  const matchingSecrets = new Set<string>();
  const matchingManifests = new Set<string>();

  for (const [secretName, rawSecret] of secrets) {
    if (!rawSecret) continue;
    for (const [secretVariant, candidateSecret] of [["raw", rawSecret], ["trimmed", rawSecret.trim()]] as const) {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(candidateSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      for (const [idName, id] of ids) {
        for (const [requestName, candidateRequestId] of requestIds) {
          const manifest = [
            `id:${id}`,
            candidateRequestId ? `request-id:${candidateRequestId}` : null,
            `ts:${timestamp}`,
          ].filter((part): part is string => part !== null).join(";") + ";";
          const expected = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest))));
          if (expected.length !== receivedHash.length) continue;
          let mismatch = 0;
          for (let index = 0; index < expected.length; index++) mismatch |= expected.charCodeAt(index) ^ receivedHash.charCodeAt(index);
          if (mismatch === 0) {
            matchingSecrets.add(`${secretName}_${secretVariant}`);
            matchingManifests.add(`${idName}_${requestName}`);
          }
        }
      }
    }
  }
  return { matchingSecrets: [...matchingSecrets], matchingManifests: [...matchingManifests] };
}
serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const allowTestPayments = Deno.env.get("MERCADOPAGO_ALLOW_TEST_PAYMENTS") === "true";
  const defaultWebhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
  const testWebhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET_TEST") || defaultWebhookSecret;
  const productionWebhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET_PROD") || defaultWebhookSecret;
  const expectedApplicationId = Deno.env.get("MERCADOPAGO_APPLICATION_ID");
  if (!supabaseUrl || !serviceRoleKey || !accessToken || (!testWebhookSecret && !productionWebhookSecret)) {
    console.error("[mp-webhook] Required configuration is missing");
    return new Response("Webhook não configurado", { status: 500 });
  }

  try {
    const url = new URL(req.url);
    const body = await req.json() as WebhookBody;
    // The signature covers the query param, not the body. Preserve its original case
    // for both HMAC validation and the local order lookup.
    const dataId = url.searchParams.get("data.id") ?? "";
    const type = body.type ?? url.searchParams.get("type");
    if (type !== "order" || !dataId) return new Response("Evento ignorado", { status: 200 });
    if (body.live_mode !== true && body.live_mode !== false) {
      console.warn("[mp-webhook] Notification has no valid live_mode; acknowledged without billing changes");
      return new Response("Notification mode missing; no billing changes", { status: 200 });
    }
    if (body.live_mode === false && !allowTestPayments) {
      console.info("[mp-webhook] Test-mode notification acknowledged; test payments are disabled in this environment");
      return new Response("Test event acknowledged; no billing changes", { status: 200 });
    }
    const webhookSecret = body.live_mode === false ? testWebhookSecret : productionWebhookSecret;
    const secretSource = body.live_mode === false
      ? (Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET_TEST") ? "TEST" : "DEFAULT_FALLBACK")
      : (Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET_PROD") ? "PROD" : "DEFAULT_FALLBACK");
    if (!webhookSecret) {
      console.error("[mp-webhook] Secret for notification mode is missing", { liveMode: body.live_mode });
      return new Response("Webhook secret not configured for this mode", { status: 500 });
    }
    const signature = req.headers.get("x-signature");
    const requestId = req.headers.get("x-request-id");
    if (!await isValidSignature(signature, requestId, dataId, webhookSecret)) {
      const diagnostic = await diagnoseSignature(signature, requestId, dataId, body.data?.id == null ? null : String(body.data.id), [
        ["TEST", Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET_TEST")],
        ["PROD", Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET_PROD")],
        ["DEFAULT", defaultWebhookSecret],
      ]);
      console.warn("[mp-webhook] Signature rejected", {
        hasSignature: Boolean(signature), hasRequestId: Boolean(requestId), hasDataId: Boolean(dataId),
        liveMode: body.live_mode, secretSource, applicationId: body.application_id ?? null,
        requestId,
        queryMatchesBody: dataId === String(body.data?.id ?? ""),
        signatureDiagnostic: diagnostic,
      });
      return new Response("Assinatura inválida", { status: 401 });
    }

    if (expectedApplicationId && String(body.application_id ?? "") !== expectedApplicationId) {
      console.warn("[mp-webhook] Notification application does not match this environment", {
        expectedApplicationId,
        receivedApplicationId: body.application_id ?? null,
      });
      return new Response("Notification application mismatch", { status: 401 });
    }

    const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      console.error("[mp-webhook] Could not retrieve order", dataId, response.status);
      return new Response("Falha ao consultar order", { status: 502 });
    }
    const order = await response.json();
    const orderApplicationId = String(order?.integration_data?.application_id ?? "");
    if (expectedApplicationId && orderApplicationId && orderApplicationId !== expectedApplicationId) {
      console.error("[mp-webhook] Retrieved order belongs to another application", {
        expectedApplicationId,
        orderApplicationId,
      });
      return new Response("Order application mismatch; no billing changes", { status: 409 });
    }
    const payments = Array.isArray(order?.transactions?.payments) ? order.transactions.payments : [];
    const payment = payments.find((entry: { payment_method?: { id?: string; type?: string } }) => {
      const method = entry.payment_method;
      return (method?.id === "pix" && method.type === "bank_transfer")
        || method?.type === "credit_card"
        || method?.type === "debit_card";
    });
    if (!payment) return new Response("Pagamento ainda não encontrado", { status: 200 });

    const localOrderId = String(order.external_reference ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(localOrderId)) {
      console.error("[mp-webhook] Invalid external reference", dataId);
      return new Response("Referência inválida", { status: 400 });
    }
    const orderStatus = String(order.status ?? "");
    const paymentStatus = String(payment.status ?? "");
    const status = orderStatus === "processed" && paymentStatus === "processed" ? "approved" : orderStatus;
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: localOrder, error: lookupError } = await supabase
      .from("billing_payment_orders")
      .select("mercadopago_order_id")
      .eq("id", localOrderId)
      .maybeSingle();
    if (lookupError || !localOrder || localOrder.mercadopago_order_id !== dataId) {
      console.error("[mp-webhook] Mercado Pago order does not match local order", dataId);
      return new Response("Order não corresponde ao pedido local", { status: 409 });
    }
    const { error } = await supabase.rpc("process_mercadopago_payment", {
      p_order_id: localOrderId,
      p_payment_id: String(payment.id ?? order.id),
      p_status: status,
      p_amount: Number(order.total_paid_amount ?? payment.paid_amount ?? payment.amount),
      p_currency: String(order.currency ?? ""),
      p_paid_at: order.last_updated_date ?? new Date().toISOString(),
      p_provider_data: order,
    });
    if (error) {
      console.error("[mp-webhook] Could not apply order", error);
      return new Response("Falha ao processar order", { status: 500 });
    }
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[mp-webhook] Error processing notification", error);
    return new Response("Erro interno", { status: 500 });
  }
});
