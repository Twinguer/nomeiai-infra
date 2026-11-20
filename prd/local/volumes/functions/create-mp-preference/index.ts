/** Cria uma cobrança mensal avulsa no Checkout Pro do Mercado Pago. */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://nomeiai.com.br",
  "https://www.nomeiai.com.br",
  "https://hml.nomeiai.com.br",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function response(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, headers);
  if (!origin || !(ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin))) {
    return response({ error: "Origem não autorizada" }, 403, headers);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  const webhookUrl = Deno.env.get("MERCADOPAGO_WEBHOOK_URL");
  const returnBaseUrl = Deno.env.get("MERCADOPAGO_RETURN_BASE_URL");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !accessToken || !webhookUrl || !returnBaseUrl) {
    console.error("[create-mp-preference] Configuração obrigatória ausente");
    return response({ error: "Pagamento indisponível no momento" }, 500, headers);
  }
  try {
    if (new URL(webhookUrl).protocol !== "https:") throw new Error("Webhook exige HTTPS");
  } catch {
    return response({ error: "URL pública do webhook Mercado Pago inválida" }, 500, headers);
  }

  try {
    if (new URL(returnBaseUrl).protocol !== "https:") throw new Error("URL de retorno exige HTTPS");
  } catch {
    return response({ error: "URL pÃºblica de retorno Mercado Pago invÃ¡lida" }, 500, headers);
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return response({ error: "Sessão inválida. Entre novamente." }, 401, headers);
    if (!user.email) return response({ error: "Adicione um e-mail válido à sua conta antes de pagar." }, 400, headers);

    const body = await req.json();
    const planId = body?.planId as keyof typeof PLANS;
    if (!(planId in PLANS)) return response({ error: "Plano inválido" }, 400, headers);
    const returnPath = body?.returnPath === "/coach/subscription" ? "/coach/subscription" : "/planos";
    const voucherCode = typeof body?.voucherCode === "string"
      ? body.voucherCode.trim().toUpperCase()
      : null;
    const plan = PLANS[planId];
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let amount = plan.amount;
    if (voucherCode) {
      const { data: voucher, error: voucherError } = await admin.rpc("validate_discount_voucher", {
        voucher_code_param: voucherCode,
      });
      if (voucherError || !voucher?.valid) {
        return response({ error: voucher?.error || "Cupom inválido ou expirado" }, 400, headers);
      }
      const discount = Number(voucher.discount_value);
      amount = voucher.discount_type === "percentage"
        ? Math.max(0.5, amount * (1 - discount / 100))
        : Math.max(0.5, amount - discount);
      amount = Number(amount.toFixed(2));
    }

    // O Checkout Pro aceita vários meios por padrão. Consultamos os meios da conta
    // e excluímos todos, exceto Pix, para respeitar a preferência do produto.
    const methodsResponse = await fetch("https://api.mercadopago.com/v1/payment_methods", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!methodsResponse.ok) throw new Error("Não foi possível consultar os meios Pix da conta");
    const methods = await methodsResponse.json();
    const paymentMethods = Array.isArray(methods) ? methods : [];
    if (!paymentMethods.some((method: { id?: string }) => method.id === "pix")) {
      throw new Error("Pix não está habilitado na conta Mercado Pago");
    }

    const externalReference = crypto.randomUUID();
    const { error: insertError } = await admin.from("billing_payment_orders").insert({
      id: externalReference,
      user_id: user.id,
      plan_id: planId,
      amount,
      currency: "BRL",
      status: "creating",
      external_reference: externalReference,
      voucher_code: voucherCode,
    });
    if (insertError) throw insertError;

    // O Mercado Pago exige HTTPS nas back_urls. O HML pode ser aberto pela
    // rede local e voltar ao domÃ­nio HTTPS prÃ³prio do ambiente.
    const baseUrl = new URL(returnBaseUrl).origin;
    const returnUrl = `${baseUrl}${returnPath}?payment=return&order_id=${externalReference}`;
    const preferencePayload = {
      items: [{
        id: planId,
        title: plan.title,
        description: "Acesso por um mês, com renovação manual por Pix",
        quantity: 1,
        currency_id: "BRL",
        unit_price: amount,
      }],
      payer: { email: user.email },
      external_reference: externalReference,
      notification_url: webhookUrl,
      back_urls: {
        success: returnUrl,
        pending: returnUrl,
        failure: `${baseUrl}${returnPath}?payment=cancelled&order_id=${externalReference}`,
      },
      auto_return: "approved",
      payment_methods: {
        excluded_payment_methods: paymentMethods
          .filter((method: { id?: string }) => method.id !== "pix")
          .map((method: { id: string }) => ({ id: method.id })),
        excluded_payment_types: Array.from(new Set(
          paymentMethods
            .map((method: { payment_type_id?: string }) => method.payment_type_id)
            .filter((type: string | undefined) => type && type !== "bank_transfer"),
        )).map((id) => ({ id })),
      },
      metadata: { user_id: user.id, plan_id: planId, order_id: externalReference },
    };

    let preferenceResponse: Response;
    let preference: { id?: string; init_point?: string };
    try {
      preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": externalReference,
        },
        body: JSON.stringify(preferencePayload),
      });
      preference = await preferenceResponse.json();
    } catch (error) {
      console.error("[create-mp-preference] Falha de comunicação com Mercado Pago", error);
      await admin.from("billing_payment_orders")
        .update({ status: "creation_failed" })
        .eq("id", externalReference);
      return response({ error: "Não foi possível iniciar o pagamento Pix" }, 502, headers);
    }
    if (!preferenceResponse.ok || !preference.init_point) {
      console.error("[create-mp-preference] Erro Mercado Pago", preferenceResponse.status, preference);
      await admin.from("billing_payment_orders").update({ status: "creation_failed" }).eq("id", externalReference);
      return response({ error: "Não foi possível iniciar o pagamento Pix" }, 502, headers);
    }

    const { error: updateError } = await admin.from("billing_payment_orders")
      .update({ status: "pending", preference_id: preference.id })
      .eq("id", externalReference);
    if (updateError) throw updateError;

    return response({ url: preference.init_point, session_id: preference.id }, 200, headers);
  } catch (error) {
    console.error("[create-mp-preference] Erro ao criar cobrança", error);
    return response({
      error: error instanceof Error ? error.message : "Erro ao iniciar pagamento",
    }, 500, headers);
  }
});
