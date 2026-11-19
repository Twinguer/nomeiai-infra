/**
 * Edge Function: verify-stripe-subscription
 * 
 * Descrição: Verifica assinatura no Stripe e atualiza banco de dados
 * Autenticação: Requer token JWT válido do Supabase
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

// ============================================
// CONFIGURAÇÃO DE ORIGENS PERMITIDAS
// ============================================
const PRODUCTION_ORIGINS = [
  "https://nomeiai.com.br",
  "https://www.nomeiai.com.br"
];

const DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080"
];

const LOCAL_IP_PATTERN = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.0\.0\.1)/;

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (PRODUCTION_ORIGINS.includes(origin)) return true;
  if (DEVELOPMENT_ORIGINS.includes(origin)) return true;
  if (LOCAL_IP_PATTERN.test(origin)) return true;
  return false;
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed && origin ? origin : PRODUCTION_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400"
  };
}

function createServiceRoleClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// Configuração de planos Coach
const COACH_PLANS = {
  coach_starter: {
    plan_type: "starter",
    price: 49.90,
    max_students: 5
  },
  coach_professional: {
    plan_type: "professional",
    price: 89.90,
    max_students: 10
  },
  coach_enterprise: {
    plan_type: "enterprise",
    price: 149.90,
    max_students: 25
  }
};

/**
 * Atualiza assinatura do usuário no banco de dados (plano Pro)
 */
async function updateUserSubscription(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  plan: "pro" | "free" = "pro",
  isActive: boolean = true,
  expiresAt?: string
): Promise<void> {
  const expirationDate = expiresAt || (() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString();
  })();
  
  const { error } = await supabase
    .from("user_subscriptions")
    .upsert(
      {
        user_id: userId,
        plan: plan,
        is_active: isActive,
        started_at: new Date().toISOString(),
        expires_at: expirationDate,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "user_id"
      }
    );
  
  if (error) {
    console.error(`[verify-stripe-subscription] Erro ao atualizar assinatura para ${userId}:`, error);
    throw error;
  }
  
  console.log(`[verify-stripe-subscription] Assinatura atualizada: userId=${userId}, plan=${plan}, isActive=${isActive}`);
}

/**
 * Atualiza assinatura do Coach no banco de dados
 */
async function updateCoachSubscription(
  supabase: ReturnType<typeof createServiceRoleClient>,
  coachId: string,
  planId: string,
  isActive: boolean = true,
  expiresAt?: string
): Promise<void> {
  const coachPlan = COACH_PLANS[planId as keyof typeof COACH_PLANS];
  if (!coachPlan) {
    throw new Error(`Plano Coach inválido: ${planId}`);
  }
  
  const expirationDate = expiresAt || (() => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1); // 1 mês (renovação mensal)
    return date.toISOString();
  })();
  
  const { error } = await supabase
    .from("coach_subscriptions")
    .upsert(
      {
        coach_id: coachId,
        plan_type: coachPlan.plan_type,
        status: isActive ? "active" : "cancelled",
        max_students: coachPlan.max_students,
        price: coachPlan.price,
        expires_at: expirationDate,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "coach_id"
      }
    );
  
  if (error) {
    console.error(`[verify-stripe-subscription] Erro ao atualizar assinatura Coach para ${coachId}:`, error);
    throw error;
  }
  
  console.log(`[verify-stripe-subscription] Assinatura Coach atualizada: coachId=${coachId}, plan=${coachPlan.plan_type}, isActive=${isActive}`);
}

/**
 * Desativa assinaturas locais expiradas (expires_at no passado).
 */
async function deactivateExpiredSubscriptionsForUser(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();

  const { error: userError } = await supabase
    .from("user_subscriptions")
    .update({ is_active: false, updated_at: now })
    .eq("user_id", userId)
    .eq("is_active", true)
    .not("expires_at", "is", null)
    .lte("expires_at", now);

  if (userError) {
    console.error(`[verify-stripe-subscription] Erro ao desativar Pro expirado para ${userId}:`, userError);
  }

  const { error: coachError } = await supabase
    .from("coach_subscriptions")
    .update({ status: "cancelled", updated_at: now })
    .eq("coach_id", userId)
    .eq("status", "active")
    .not("expires_at", "is", null)
    .lte("expires_at", now);

  if (coachError) {
    console.error(`[verify-stripe-subscription] Erro ao cancelar Coach expirado para ${userId}:`, coachError);
  }
}

serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed", details: "Apenas requisições POST são permitidas" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (Deno.env.get("STRIPE_BILLING_ENABLED") !== "true") {
    return new Response(
      JSON.stringify({ success: false, message: "Stripe está desativado." }),
      { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    // Criar cliente Supabase para autenticação
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Verificar autenticação
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.error("[verify-stripe-subscription] Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Unauthorized", details: authError?.message || "Token inválido ou expirado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[verify-stripe-subscription] User authenticated: ${user.id}, email: ${user.email}`);

    // Validar origem
    if (!isAllowedOrigin(origin)) {
      console.warn(`[verify-stripe-subscription] Origem não permitida: ${origin}`);
      return new Response(
        JSON.stringify({ error: "Forbidden", details: "Origem não autorizada" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Inicializar Stripe e detectar modo
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("[verify-stripe-subscription] STRIPE_SECRET_KEY não configurado");
      throw new Error("Configuração do Stripe não encontrada");
    }

    // Verificar se é chave de teste ou produção
    const isTestMode = stripeSecretKey.startsWith("sk_test_");
    const isLiveMode = stripeSecretKey.startsWith("sk_live_");
    
    if (!isTestMode && !isLiveMode) {
      console.error("[verify-stripe-subscription] Chave Stripe inválida (deve começar com sk_test_ ou sk_live_)");
      throw new Error("Chave Stripe inválida");
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    // Buscar customer no Stripe por email
    const customers = await stripe.customers.list({
      email: user.email || undefined,
      limit: 1,
    });

    if (customers.data.length === 0) {
      console.log(`[verify-stripe-subscription] Customer não encontrado para ${user.email}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Nenhuma assinatura encontrada no Stripe" 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const customer = customers.data[0];
    console.log(`[verify-stripe-subscription] Customer encontrado: ${customer.id}`);

    // Buscar assinaturas ativas do customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      console.log(`[verify-stripe-subscription] Nenhuma assinatura ativa encontrada para customer ${customer.id}`);
      const serviceRoleSupabase = createServiceRoleClient();
      await deactivateExpiredSubscriptionsForUser(serviceRoleSupabase, user.id);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Nenhuma assinatura ativa encontrada",
          deactivated_expired: true
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const subscription = subscriptions.data[0];
    console.log(`[verify-stripe-subscription] Assinatura ativa encontrada: ${subscription.id}, status: ${subscription.status}`);

    // Verificar se a assinatura está realmente ativa
    if (subscription.status === "active") {
      // Obter user_id e plan_id do metadata
      let userId = subscription.metadata?.user_id || customer.metadata?.user_id || user.id;
      let planId = subscription.metadata?.plan_id || customer.metadata?.plan_id;
      
      if (!planId) {
        // Tentar identificar pelo price_id da subscription
        const priceId = subscription.items.data[0]?.price?.id;
        console.log(`[verify-stripe-subscription] Plan ID não encontrado no metadata, tentando identificar pelo price_id: ${priceId}`);
        
        // Mapear price_id para planId (baseado no modo)
        const STRIPE_PRICES_TEST: Record<string, string> = {
          "price_1SRagSFBsZSweLR7D5kE6D7h": "pro",
          "price_1SRaimFBsZSweLR714Du0mqE": "coach_starter",
          "price_1SRah0FBsZSweLR7DI1hiPsv": "coach_professional",
          "price_1SRai8FBsZSweLR7A93PGay8": "coach_enterprise"
        };
        
        // Price IDs do Stripe - Modo PRODUÇÃO (LIVE)
        const STRIPE_PRICES_LIVE: Record<string, string> = {
          "price_1SRaGrFbBP7AYhAYK3UISUzO": "pro",
          "price_1SRaHbFbBP7AYhAYcjvOF6bB": "coach_starter",
          "price_1SRaI8FbBP7AYhAYWHNeSPMW": "coach_professional",
          "price_1SRaIbFbBP7AYhAYgbDmmBdG": "coach_enterprise"
        };
        
        const priceToPlan = isTestMode ? STRIPE_PRICES_TEST : STRIPE_PRICES_LIVE;
        
        planId = priceToPlan[priceId || ""] || "pro";
        console.log(`[verify-stripe-subscription] Plan ID identificado: ${planId}`);
      }
      
      if (!userId) {
        userId = user.id;
        console.warn(`[verify-stripe-subscription] user_id não encontrado no metadata, usando user.id da autenticação`);
      }

      // Determinar se é plano Coach
      const isCoachPlan = planId.startsWith("coach_");
      const expiresAt = new Date(subscription.current_period_end * 1000).toISOString();
      
      // Atualizar banco de dados
      const serviceRoleSupabase = createServiceRoleClient();
      
      if (isCoachPlan) {
        await updateCoachSubscription(serviceRoleSupabase, userId, planId, true, expiresAt);
        console.log(`[verify-stripe-subscription] Assinatura Coach verificada e ativada para userId: ${userId}, plan: ${planId}`);
      } else {
        await updateUserSubscription(serviceRoleSupabase, userId, "pro", true, expiresAt);
        console.log(`[verify-stripe-subscription] Assinatura Pro verificada e ativada para userId: ${userId}`);
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Assinatura verificada e ativada com sucesso",
          subscription_id: subscription.id,
          plan_id: planId
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      console.log(`[verify-stripe-subscription] Assinatura encontrada mas não está ativa: status=${subscription.status}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `Assinatura encontrada mas status é: ${subscription.status}` 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[verify-stripe-subscription] Erro não tratado:", error);
    
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: errorMessage
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
