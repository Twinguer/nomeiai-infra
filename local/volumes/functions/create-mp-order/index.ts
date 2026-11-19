/** Creates a monthly Pix or card order using Mercado Pago Checkout Pro Orders API. */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://nomeiai.com.br", "https://www.nomeiai.com.br", "https://hml.nomeiai.com.br",
  "http://localhost:3000", "http://localhost:5173", "http://localhost:8080",
];
const LOCAL_ORIGIN = /^http:\/\/(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|127\.0\.0\.1)(?::\d{1,5})?$/;
const PLANS = {
  pro: { title: "Nomeia Aí Pro — 1 mês", amount: 9.9 },
  coach_starter: { title: "Nomeia Aí Coach — 1 mês", amount: 49.9 },
} as const;

function cors(origin: string | null): Record<string, string> {
  const allowed = !!origin && (ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed && origin ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400", Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);
  if (!origin || !(ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin))) {
    return json({ error: "Origem não autorizada" }, 403, headers);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const webhookUrl = Deno.env.get("MERCADOPAGO_WEBHOOK_URL");
  const returnBaseUrl = Deno.env.get("MERCADOPAGO_RETURN_BASE_URL");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !accessToken || !webhookUrl || !returnBaseUrl) {
    console.error("[create-mp-order] Required configuration is missing");
    return json({ error: "Pagamento indisponível no momento" }, 500, headers);
  }
  try {
    if (new URL(webhookUrl).protocol !== "https:" || new URL(returnBaseUrl).protocol !== "https:") throw new Error();
  } catch {
    return json({ error: "Configure URLs HTTPS para retorno e webhook do Mercado Pago" }, 500, headers);
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401, headers);
    if (!user.email) return json({ error: "Adicione um e-mail válido à sua conta antes de pagar." }, 400, headers);
    const registrationDate = user.created_at && !Number.isNaN(Date.parse(user.created_at))
      ? new Date(user.created_at).toISOString()
      : undefined;
    // Orders expects dotted additional_info keys literally (e.g. "payer.registration_date"),
    // not a nested { payer: { registration_date } } object.
    const additionalInfo = registrationDate ? { "payer.registration_date": registrationDate } : undefined;

    const body = await req.json();
    const planId = body?.planId as keyof typeof PLANS;
    if (!(planId in PLANS)) return json({ error: "Plano inválido" }, 400, headers);
    const paymentMethod = body?.paymentMethod === "pix" ? "pix" : body?.paymentMethod === "card" ? "card" : null;
    if (!paymentMethod) return json({ error: "Selecione Pix ou cartão para continuar." }, 400, headers);
    const returnPath = body?.returnPath === "/coach/subscription" ? "/coach/subscription" : "/planos";
    const voucherCode = typeof body?.voucherCode === "string" ? body.voucherCode.trim().toUpperCase() : null;
    const plan = PLANS[planId];
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

    let amount = plan.amount;
    if (voucherCode) {
      const { data: voucher, error } = await admin.rpc("validate_discount_voucher", { voucher_code_param: voucherCode });
      if (error || !voucher?.valid) return json({ error: voucher?.error || "Cupom inválido ou expirado" }, 400, headers);
      const discount = Number(voucher.discount_value);
      amount = Number((voucher.discount_type === "percentage"
        ? Math.max(0.5, amount * (1 - discount / 100))
        : Math.max(0.5, amount - discount)).toFixed(2));
    }

    const allowedPaymentTypes = new Set(["credit_card", "debit_card"]);
    let methods: Array<{ payment_type_id?: string }> = [];
    if (paymentMethod === "card") {
      const methodsResponse = await fetch("https://api.mercadopago.com/v1/payment_methods", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!methodsResponse.ok) throw new Error("Não foi possível consultar os meios de pagamento da conta");
      const responseMethods = await methodsResponse.json();
      if (!Array.isArray(responseMethods)) throw new Error("Não foi possível consultar os meios de pagamento da conta");
      methods = responseMethods;
      const cardAvailable = methods.some((method) => method.payment_type_id && allowedPaymentTypes.has(method.payment_type_id));
      if (!cardAvailable) return json({ error: "Cartão não está habilitado para esta conta Mercado Pago." }, 400, headers);
    }

    const externalReference = crypto.randomUUID();
    const { error: insertError } = await admin.from("billing_payment_orders").insert({
      id: externalReference, user_id: user.id, plan_id: planId, amount, currency: "BRL",
      status: "creating", external_reference: externalReference, voucher_code: voucherCode,
    });
    if (insertError) throw insertError;

    const baseUrl = new URL(returnBaseUrl).origin;
    const returnUrl = `${baseUrl}${returnPath}?payment=return&order_id=${externalReference}`;
    const cardPayload = {
      type: "online",
      total_amount: amount.toFixed(2),
      external_reference: externalReference,
      processing_mode: "manual",
      capture_mode: "automatic_async",
      payer: { email: user.email },
      additional_info: additionalInfo,
      config: {
        statement_descriptor: "NOMEIA AI",
        online: {
          success_url: returnUrl,
          pending_url: returnUrl,
          failure_url: `${baseUrl}${returnPath}?payment=cancelled&order_id=${externalReference}`,
          auto_return: "approved",
          transaction_security: {
            validation: "on_fraud_risk",
            liability_shift: "required",
          },
        },
        payment_method: {
          not_allowed_types: Array.from(new Set(methods.map((method: { payment_type_id?: string }) => method.payment_type_id)
            .filter((type: string | undefined) => type && !allowedPaymentTypes.has(type)))),
          max_installments: 1,
        },
      },
      items: [{ external_code: planId, title: plan.title, description: "Acesso por um mês, com renovação manual", category_id: "education", quantity: 1, unit_price: amount.toFixed(2) }],
      description: plan.title,
    };
    const allowTestPayments = Deno.env.get("MERCADOPAGO_ALLOW_TEST_PAYMENTS") === "true";
    const pixPayload = {
      type: "online",
      total_amount: amount.toFixed(2),
      external_reference: externalReference,
      processing_mode: "automatic",
      payer: allowTestPayments ? { email: user.email, first_name: "APRO" } : { email: user.email },
      additional_info: additionalInfo,
      config: {
        online: {
          success_url: returnUrl,
          pending_url: returnUrl,
          failure_url: `${baseUrl}${returnPath}?payment=cancelled&order_id=${externalReference}`,
          auto_return: "approved",
        },
      },
      transactions: {
        payments: [{
          amount: amount.toFixed(2),
          payment_method: { id: "pix", type: "bank_transfer" },
        }],
      },
      items: [{
        external_code: planId,
        title: plan.title,
        description: "Acesso por um mês, com renovação manual",
        category_id: "education",
        quantity: 1,
        unit_price: amount.toFixed(2),
      }],
      description: plan.title,
    };
    const payload = paymentMethod === "pix" ? pixPayload : cardPayload;

    let mpResponse: Response;
    let order: {
      id?: string;
      checkout_url?: string;
      transactions?: { payments?: Array<{ payment_method?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } }> };
      errors?: Array<{ code?: string; message?: string; details?: string[] }>;
    };
    try {
      mpResponse = await fetch("https://api.mercadopago.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "X-Idempotency-Key": externalReference },
        body: JSON.stringify(payload),
      });
      order = await mpResponse.json();
    } catch (error) {
      console.error("[create-mp-order] Mercado Pago request failed", error);
      await admin.from("billing_payment_orders").update({ status: "creation_failed" }).eq("id", externalReference);
      return json({ error: "Não foi possível iniciar o pagamento" }, 502, headers);
    }
    const pixDetails = order.transactions?.payments?.[0]?.payment_method;
    const hasCheckout = paymentMethod === "pix"
      ? !!(pixDetails?.qr_code || pixDetails?.ticket_url)
      : !!order.checkout_url;
    if (!mpResponse.ok || !order.id || !hasCheckout) {
      console.error("[create-mp-order] Mercado Pago rejected the order", mpResponse.status, order);
      await admin.from("billing_payment_orders").update({ status: "creation_failed", provider_data: order }).eq("id", externalReference);
      const providerDetails = order.errors?.flatMap((entry) => [entry.message, ...(entry.details ?? [])])
        .filter((detail): detail is string => !!detail).join("; ").slice(0, 400);
      return json({
        error: "Não foi possível iniciar o pagamento",
        ...(providerDetails ? { details: providerDetails } : {}),
      }, 502, headers);
    }

    const { error: updateError } = await admin.from("billing_payment_orders")
      .update({ status: "pending", mercadopago_order_id: order.id, provider_data: order })
      .eq("id", externalReference);
    if (updateError) throw updateError;
    if (paymentMethod === "pix") {
      return json({
        method: "pix",
        order_id: externalReference,
        session_id: order.id,
        qr_code: pixDetails?.qr_code ?? null,
        qr_code_base64: pixDetails?.qr_code_base64 ?? null,
        ticket_url: pixDetails?.ticket_url ?? null,
      }, 200, headers);
    }
    return json({ method: "card", order_id: externalReference, url: order.checkout_url, session_id: order.id }, 200, headers);
  } catch (error) {
    console.error("[create-mp-order] Error creating order", error);
    return json({ error: error instanceof Error ? error.message : "Erro ao iniciar pagamento" }, 500, headers);
  }
});
