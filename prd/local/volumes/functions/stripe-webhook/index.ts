/**
 * Edge Function: stripe-webhook
 * 
 * Descrição: Processa webhooks do Stripe para atualizar assinaturas
 * Autenticação: Não requer JWT (webhook do Stripe)
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";

// ============================================
// CONFIGURAÇÃO
// ============================================

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

// Price IDs do Stripe - Modo TESTE
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

// Função para obter mapeamento de Price IDs baseado no modo
function getPriceToPlanMapping(isTestMode: boolean): Record<string, string> {
  return isTestMode ? STRIPE_PRICES_TEST : STRIPE_PRICES_LIVE;
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

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

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

/**
 * Atualiza assinatura do usuário no banco de dados (plano Pro)
 */
async function updateUserSubscription(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  planId: string,
  status: string,
  expiresAt?: string
): Promise<void> {
  const isActive = status === "active" || status === "trialing";
  const currentExpiresAt = expiresAt ? new Date(expiresAt).toISOString() : (() => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1); // 1 mês (renovação mensal)
    return date.toISOString();
  })();
  
  const { error } = await supabase
    .from("user_subscriptions")
    .upsert(
      {
        user_id: userId,
        plan: planId === "pro" ? "pro" : "free",
        is_active: isActive,
        started_at: new Date().toISOString(),
        expires_at: currentExpiresAt,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "user_id"
      }
    );
  
  if (error) {
    console.error(`[stripe-webhook] Erro ao atualizar assinatura para ${userId}:`, error);
    throw error;
  }
  
  console.log(`[stripe-webhook] Assinatura atualizada: userId=${userId}, plan=${planId}, status=${status}, expiresAt=${currentExpiresAt}`);
}

/**
 * Atualiza assinatura do Coach no banco de dados
 */
async function updateCoachSubscription(
  supabase: ReturnType<typeof createServiceRoleClient>,
  coachId: string,
  planId: string,
  status: string,
  expiresAt?: string
): Promise<void> {
  const coachPlan = COACH_PLANS[planId as keyof typeof COACH_PLANS];
  if (!coachPlan) {
    throw new Error(`Plano Coach inválido: ${planId}`);
  }
  
  const isActive = status === "active" || status === "trialing";
  const currentExpiresAt = expiresAt ? new Date(expiresAt).toISOString() : (() => {
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
        expires_at: currentExpiresAt,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "coach_id"
      }
    );

  if (error) {
    console.error(`[stripe-webhook] Erro ao atualizar assinatura Coach para ${coachId}:`, error);
    throw error;
  }

  console.log(`[stripe-webhook] Assinatura Coach atualizada: coachId=${coachId}, plan=${coachPlan.plan_type}, status=${status}, expiresAt=${currentExpiresAt}`);
}

/**
 * Cancela/desativa assinatura do usuário
 * Remove o registro da tabela (usuário volta para Free)
 */
async function cancelUserSubscription(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("user_subscriptions")
    .delete()
    .eq("user_id", userId);
  
  if (error) {
    console.error(`[stripe-webhook] Erro ao cancelar assinatura para ${userId}:`, error);
    throw error;
  }
  
  console.log(`[stripe-webhook] Assinatura cancelada e registro removido: userId=${userId} (agora é Free)`);
}

/**
 * Cancela/desativa assinatura do Coach
 */
async function cancelCoachSubscription(
  supabase: ReturnType<typeof createServiceRoleClient>,
  coachId: string
): Promise<void> {
  const { error } = await supabase
    .from("coach_subscriptions")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString()
    })
    .eq("coach_id", coachId);
  
  if (error) {
    console.error(`[stripe-webhook] Erro ao cancelar assinatura Coach para ${coachId}:`, error);
    throw error;
  }
  
  console.log(`[stripe-webhook] Assinatura Coach cancelada: coachId=${coachId}`);
}

// ============================================
// HANDLER PRINCIPAL
// ============================================

serve(async (req: Request): Promise<Response> => {
  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "stripe-signature, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (Deno.env.get("STRIPE_BILLING_ENABLED") !== "true") {
    return new Response(
      JSON.stringify({ error: "Stripe está desativado." }),
      { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabase = createServiceRoleClient();
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    
    if (!stripeSecretKey) {
      console.error("[stripe-webhook] STRIPE_SECRET_KEY não configurado");
      throw new Error("STRIPE_SECRET_KEY não configurado");
    }

    // Verificar se é chave de teste ou produção
    const isTestMode = stripeSecretKey.startsWith("sk_test_");
    const isLiveMode = stripeSecretKey.startsWith("sk_live_");
    
    if (!isTestMode && !isLiveMode) {
      console.error("[stripe-webhook] Chave Stripe inválida (deve começar com sk_test_ ou sk_live_)");
      throw new Error("Chave Stripe inválida");
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    // Obter o corpo da requisição e a assinatura
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      console.error("[stripe-webhook] Assinatura Stripe não encontrada");
      return new Response(
        JSON.stringify({ error: "Missing stripe-signature header" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!STRIPE_WEBHOOK_SECRET) {
      console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET não configurado");
      return new Response(
        JSON.stringify({ error: "STRIPE_WEBHOOK_SECRET não configurado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar a assinatura do webhook
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error("[stripe-webhook] Erro ao verificar assinatura:", err.message);
      return new Response(
        JSON.stringify({ error: `Webhook signature verification failed: ${err.message}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[stripe-webhook] Evento recebido: ${event.type}, id: ${event.id}`);

    // Processar diferentes tipos de eventos
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`[stripe-webhook] Checkout session completed: ${session.id}`);
        
        // Verificar se é uma assinatura
        if (session.mode === "subscription" && session.customer) {
          const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
          
          // Buscar subscription associada
          const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            limit: 1,
          });
          
          if (subscriptions.data.length > 0) {
            const subscription = subscriptions.data[0];
            const userId = session.metadata?.user_id;
            const planId = session.metadata?.plan_id;
            
            if (userId && subscription.status === "active") {
              const expiresAt = new Date(subscription.current_period_end * 1000).toISOString();
              const isCoachPlan = planId?.startsWith("coach_");
              const voucherCode = session.metadata?.voucher_code;
              
              if (isCoachPlan && planId) {
                await updateCoachSubscription(supabase, userId, planId, subscription.status, expiresAt);
                console.log(`[stripe-webhook] Assinatura Coach ativada para userId: ${userId}, plan: ${planId}`);
              } else {
                await updateUserSubscription(supabase, userId, "pro", subscription.status, expiresAt);
                console.log(`[stripe-webhook] Assinatura Pro ativada para userId: ${userId}`);
              }
              
              // Marcar voucher como usado se houver
              if (voucherCode) {
                const { error: voucherError } = await supabase
                  .from("vouchers_applied")
                  .insert({
                    user_id: userId,
                    voucher_code: voucherCode,
                    applied_at: new Date().toISOString()
                  });
                
                if (voucherError) {
                  console.error(`[stripe-webhook] Erro ao marcar voucher como usado: ${voucherCode}`, voucherError);
                } else {
                  console.log(`[stripe-webhook] Voucher marcado como usado: ${voucherCode} para userId: ${userId}`);
                }
              }
            }
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log(`[stripe-webhook] Subscription ${event.type}: ${subscription.id}, status: ${subscription.status}`);
        
        // Buscar user_id e plan_id no metadata da subscription ou do customer
        let userId: string | undefined;
        let planId: string | undefined;
        
        // Tentar obter do metadata da subscription
        if (subscription.metadata?.user_id) {
          userId = subscription.metadata.user_id;
          planId = subscription.metadata.plan_id;
        } else {
          // Buscar customer para obter metadata
          const customer = await stripe.customers.retrieve(subscription.customer as string);
          if (typeof customer !== "string" && !customer.deleted) {
            userId = customer.metadata?.user_id;
            planId = customer.metadata?.plan_id;
          }
        }
        
        // Se não encontrou planId, tentar identificar pelo price_id
        if (!planId && subscription.items.data.length > 0) {
          const priceId = subscription.items.data[0]?.price?.id;
          const priceToPlan = getPriceToPlanMapping(isTestMode);
          planId = priceToPlan[priceId || ""] || "pro";
        }
        
        if (userId) {
          const expiresAt = new Date(subscription.current_period_end * 1000).toISOString();
          const isCoachPlan = planId?.startsWith("coach_");
          
          if (subscription.status === "active" || subscription.status === "trialing") {
            if (isCoachPlan && planId) {
              await updateCoachSubscription(supabase, userId, planId, subscription.status, expiresAt);
              console.log(`[stripe-webhook] Assinatura Coach ${subscription.status} para userId: ${userId}, plan: ${planId}`);
            } else {
              await updateUserSubscription(supabase, userId, "pro", subscription.status, expiresAt);
              console.log(`[stripe-webhook] Assinatura Pro ${subscription.status} para userId: ${userId}`);
            }
          } else if (subscription.status === "canceled" || subscription.status === "unpaid" || subscription.status === "past_due") {
            if (isCoachPlan) {
              await cancelCoachSubscription(supabase, userId);
              console.log(`[stripe-webhook] Assinatura Coach cancelada para userId: ${userId}`);
            } else {
              await cancelUserSubscription(supabase, userId);
              console.log(`[stripe-webhook] Assinatura Pro cancelada para userId: ${userId}`);
            }
          }
        } else {
          console.warn(`[stripe-webhook] user_id não encontrado no metadata para subscription ${subscription.id}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log(`[stripe-webhook] Subscription deleted: ${subscription.id}`);
        
        let userId: string | undefined;
        let planId: string | undefined;
        
        if (subscription.metadata?.user_id) {
          userId = subscription.metadata.user_id;
          planId = subscription.metadata.plan_id;
        } else {
          const customer = await stripe.customers.retrieve(subscription.customer as string);
          if (typeof customer !== "string" && !customer.deleted) {
            userId = customer.metadata?.user_id;
            planId = customer.metadata?.plan_id;
          }
        }
        
        // Identificar pelo price_id se necessário
        if (!planId && subscription.items.data.length > 0) {
          const priceId = subscription.items.data[0]?.price?.id;
          const priceToPlan: Record<string, string> = {
            "price_1SRagSFBsZSweLR7D5kE6D7h": "pro",
            "price_1SRaimFBsZSweLR714Du0mqE": "coach_starter",
            "price_1SRah0FBsZSweLR7DI1hiPsv": "coach_professional",
            "price_1SRai8FBsZSweLR7A93PGay8": "coach_enterprise"
          };
          planId = priceToPlan[priceId || ""] || "pro";
        }
        
        if (userId) {
          const isCoachPlan = planId?.startsWith("coach_");
          if (isCoachPlan) {
            await cancelCoachSubscription(supabase, userId);
            console.log(`[stripe-webhook] Assinatura Coach deletada para userId: ${userId}`);
          } else {
            await cancelUserSubscription(supabase, userId);
            console.log(`[stripe-webhook] Assinatura Pro deletada para userId: ${userId}`);
          }
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log(`[stripe-webhook] Invoice payment succeeded: ${invoice.id}`);
        
        // Se for uma assinatura, garantir que está ativa
        if (invoice.subscription) {
          const subscriptionId = typeof invoice.subscription === "string" 
            ? invoice.subscription 
            : invoice.subscription.id;
          
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          let userId: string | undefined;
          let planId: string | undefined;
          
          if (subscription.metadata?.user_id) {
            userId = subscription.metadata.user_id;
            planId = subscription.metadata.plan_id;
          } else {
            const customer = await stripe.customers.retrieve(subscription.customer as string);
            if (typeof customer !== "string" && !customer.deleted) {
              userId = customer.metadata?.user_id;
              planId = customer.metadata?.plan_id;
            }
          }
          
          // Identificar pelo price_id se necessário
          if (!planId && subscription.items.data.length > 0) {
            const priceId = subscription.items.data[0]?.price?.id;
            const priceToPlan = getPriceToPlanMapping(isTestMode);
            planId = priceToPlan[priceId || ""] || "pro";
          }
          
          if (userId && subscription.status === "active") {
            const expiresAt = new Date(subscription.current_period_end * 1000).toISOString();
            const isCoachPlan = planId?.startsWith("coach_");
            
            if (isCoachPlan && planId) {
              await updateCoachSubscription(supabase, userId, planId, subscription.status, expiresAt);
              console.log(`[stripe-webhook] Assinatura Coach renovada para userId: ${userId}, plan: ${planId}`);
            } else {
              await updateUserSubscription(supabase, userId, "pro", subscription.status, expiresAt);
              console.log(`[stripe-webhook] Assinatura Pro renovada para userId: ${userId}`);
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log(`[stripe-webhook] Invoice payment failed: ${invoice.id}`);
        // Não cancelar imediatamente, o Stripe tentará novamente
        break;
      }

      default:
        console.log(`[stripe-webhook] Evento não processado: ${event.type}`);
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[stripe-webhook] Erro não tratado:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Erro desconhecido"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
