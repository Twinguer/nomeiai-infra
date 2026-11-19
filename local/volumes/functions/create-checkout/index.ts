/**
 * Edge Function: create-checkout
 * 
 * Descrição: Cria sessão de checkout no Stripe
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

// Padrão para detectar IPs locais
const LOCAL_IP_PATTERN = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.0\.0\.1)/;

// ============================================
// CONFIGURAÇÃO DE PLANOS E PRICES DO STRIPE
// ============================================
// Price IDs do Stripe - Modo TESTE
const STRIPE_PRICES_TEST = {
  pro: "price_1SRagSFBsZSweLR7D5kE6D7h", // R$ 14,90/mês - Aluno Pro
  coach_starter: "price_1SRaimFBsZSweLR714Du0mqE", // R$ 49,90/mês - Modo Coach Inicial (5 alunos)
  coach_professional: "price_1SRah0FBsZSweLR7DI1hiPsv", // R$ 89,90/mês - Modo Coach Intermediário (10 alunos)
  coach_enterprise: "price_1SRai8FBsZSweLR7A93PGay8", // R$ 149,90/mês - Modo Coach Avançado (25 alunos)
};

// Price IDs do Stripe - Modo PRODUÇÃO (LIVE)
const STRIPE_PRICES_LIVE = {
  pro: "price_1SRaGrFbBP7AYhAYK3UISUzO", // R$ 14,90/mês - Aluno Pro
  coach_starter: "price_1SRaHbFbBP7AYhAYcjvOF6bB", // R$ 49,90/mês - Modo Coach Inicial (5 alunos)
  coach_professional: "price_1SRaI8FbBP7AYhAYWHNeSPMW", // R$ 89,90/mês - Modo Coach Intermediário (10 alunos)
  coach_enterprise: "price_1SRaIbFbBP7AYhAYgbDmmBdG", // R$ 149,90/mês - Modo Coach Avançado (25 alunos)
};

// Função para obter Price IDs baseado no modo (teste ou produção)
function getStripePrices(isTestMode: boolean) {
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

// ============================================
// HANDLER PRINCIPAL
// ============================================

serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  
  // Tratar OPTIONS (preflight)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  // Validar método HTTP
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ 
        error: "Method not allowed",
        details: "Apenas requisições POST são permitidas" 
      }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }

  if (Deno.env.get("STRIPE_BILLING_ENABLED") !== "true") {
    return new Response(
      JSON.stringify({ error: "Novas compras estão disponíveis somente via Pix." }),
      {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    // Verificar se Stripe está disponível
    if (typeof Stripe === "undefined" || !Stripe) {
      console.error("[create-checkout] Stripe não está disponível");
      throw new Error("Módulo Stripe não foi carregado corretamente");
    }
    // Criar cliente Supabase
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
      console.error("[create-checkout] Auth error:", authError);
      return new Response(
        JSON.stringify({ 
          error: "Unauthorized",
          details: authError?.message || "Token inválido ou expirado. Por favor, faça login novamente." 
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
    
    console.log(`[create-checkout] User authenticated: ${user.id}, email: ${user.email}`);

    // Validar origem
    if (!isAllowedOrigin(origin)) {
      console.warn(`[create-checkout] Origem não permitida: ${origin}`);
      return new Response(
        JSON.stringify({ 
          error: "Forbidden",
          details: "Origem não autorizada" 
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
    
    // Parsear body
    let requestData: { planId: string; voucherCode?: string };
    try {
      const body = await req.json();
      console.log(`[create-checkout] Body recebido:`, JSON.stringify(body));
      if (!body.planId || typeof body.planId !== "string") {
        console.error(`[create-checkout] planId inválido ou ausente:`, body);
        throw new Error("planId é obrigatório");
      }
      requestData = { 
        planId: body.planId,
        voucherCode: body.voucherCode || undefined
      };
      console.log(`[create-checkout] planId validado: ${requestData.planId}, voucher: ${requestData.voucherCode || 'nenhum'}`);
    } catch (error) {
      console.error(`[create-checkout] Erro ao parsear body:`, error);
      return new Response(
        JSON.stringify({ 
          error: "Bad Request",
          details: "Body da requisição inválido ou planId não fornecido" 
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
    
    // Validar planId e obter price_id do Stripe
    const validPlanIds = ["pro", "coach_starter", "coach_professional", "coach_enterprise"];
    console.log(`[create-checkout] Validando planId: ${requestData.planId} contra: ${validPlanIds.join(", ")}`);
    if (!validPlanIds.includes(requestData.planId)) {
      console.error(`[create-checkout] Plano inválido: ${requestData.planId}`);
      return new Response(
        JSON.stringify({ 
          error: "Bad Request",
          details: `Plano inválido. Planos disponíveis: ${validPlanIds.join(", ")}` 
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Determinar se é plano Coach
    const isCoachPlan = requestData.planId.startsWith("coach_");
    
    // Inicializar Stripe e detectar modo
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("[create-checkout] STRIPE_SECRET_KEY não configurado");
      throw new Error("Configuração do Stripe não encontrada");
    }
    
    // Verificar se é chave de teste ou produção
    const isTestMode = stripeSecretKey.startsWith("sk_test_");
    const isLiveMode = stripeSecretKey.startsWith("sk_live_");
    
    console.log(`[create-checkout] 🔍 Detecção de modo Stripe:`, {
      keyPrefix: stripeSecretKey.substring(0, 12),
      isTestMode,
      isLiveMode,
      keyLength: stripeSecretKey.length
    });
    
    if (!isTestMode && !isLiveMode) {
      console.error("[create-checkout] Chave Stripe inválida (deve começar com sk_test_ ou sk_live_)");
      throw new Error("Chave Stripe inválida");
    }
    
    // Obter Price IDs baseado no modo (teste ou produção)
    const STRIPE_PRICES = getStripePrices(isTestMode);
    const priceId = STRIPE_PRICES[requestData.planId as keyof typeof STRIPE_PRICES];
    
    console.log(`[create-checkout] 📋 Price IDs selecionados:`, {
      mode: isTestMode ? "TESTE" : "PRODUÇÃO",
      planId: requestData.planId,
      priceId: priceId || "NÃO ENCONTRADO",
      availablePlans: Object.keys(STRIPE_PRICES)
    });
    
    if (!priceId || priceId.includes("PREENCHER")) {
      const mode = isTestMode ? "TESTE" : "PRODUÇÃO";
      throw new Error(`Price ID não configurado para o plano ${requestData.planId} no modo ${mode}. Verifique STRIPE_PRICES_${isTestMode ? "TEST" : "LIVE"}`);
    }
    
    console.log(`[create-checkout] ✅ Inicializando Stripe com chave: ${stripeSecretKey.substring(0, 12)}... (modo: ${isTestMode ? "TESTE" : "LIVE"})`);
    
    let stripe;
    try {
      stripe = new Stripe(stripeSecretKey, {
        apiVersion: "2023-10-16",
      });
    } catch (error) {
      console.error("[create-checkout] Erro ao inicializar cliente Stripe:", error);
      throw new Error(`Erro ao inicializar Stripe: ${error instanceof Error ? error.message : "Erro desconhecido"}`);
    }
    
    // Construir URL base
    const baseUrl = (origin && origin.trim()) ? origin : PRODUCTION_ORIGINS[0];
    
    // Redirecionar para página apropriada após pagamento bem-sucedido
    const successUrl = isCoachPlan
      ? `${baseUrl}/coach/subscription?status=success&plan=${requestData.planId}`
      : `${baseUrl}/planos?status=success&plan=${requestData.planId}`;
    const cancelUrl = isCoachPlan
      ? `${baseUrl}/coach/subscription?status=canceled`
      : `${baseUrl}/planos?status=canceled`;
    
    // Criar ou buscar customer no Stripe (necessário para Accounts V2)
    let customerId: string;
    try {
      // Buscar customer existente por email
      const existingCustomers = await stripe.customers.list({
        email: user.email || undefined,
        limit: 1,
      });
      
      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
        console.log(`[create-checkout] Customer existente encontrado: ${customerId}`);
        
        // Atualizar metadata do customer existente para garantir que plan_id está correto
        try {
          await stripe.customers.update(customerId, {
            metadata: {
              user_id: user.id,
              plan_id: requestData.planId,
            },
          });
          console.log(`[create-checkout] Metadata do customer atualizado com plan_id: ${requestData.planId}`);
        } catch (updateError: any) {
          console.warn(`[create-checkout] Aviso: Não foi possível atualizar metadata do customer: ${updateError?.message}`);
          // Não falhar o checkout por causa disso, apenas logar
        }
      } else {
        // Criar novo customer com metadata
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: {
            user_id: user.id,
            plan_id: requestData.planId,
          },
        });
        customerId = customer.id;
        console.log(`[create-checkout] Novo customer criado: ${customerId}`);
      }
    } catch (customerError: any) {
      console.error("[create-checkout] Erro ao criar/buscar customer:", customerError);
      throw new Error(`Erro ao criar customer no Stripe: ${customerError?.message || "Erro desconhecido"}`);
    }

    // ============================================
    // VERIFICAR SE JÁ EXISTE ASSINATURA ATIVA DO MESMO TIPO (UPGRADE/DOWNGRADE)
    // ============================================
    let existingSubscription: Stripe.Subscription | null = null;
    let isUpgrade = false;
    
    try {
      // Buscar assinaturas ativas do customer
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 10, // Buscar todas para verificar se há do mesmo tipo
      });

      // Verificar se há assinatura ativa do mesmo tipo (Pro ou Coach)
      for (const sub of subscriptions.data) {
        const currentPriceId = sub.items.data[0]?.price?.id;
        const currentPlanId = Object.entries(STRIPE_PRICES).find(([_, price]) => price === currentPriceId)?.[0];
        
        // Verificar se é do mesmo tipo (Pro ou Coach)
        const isCurrentPlanCoach = currentPlanId?.startsWith("coach_");
        const isNewPlanCoach = requestData.planId.startsWith("coach_");
        
        if (isCurrentPlanCoach === isNewPlanCoach) {
          // Mesmo tipo de plano (Pro ou Coach)
          existingSubscription = sub;
          isUpgrade = currentPlanId !== requestData.planId; // Se o plano é diferente, é upgrade/downgrade
          console.log(`[create-checkout] Assinatura ativa encontrada: ${sub.id}, plano atual: ${currentPlanId}, novo plano: ${requestData.planId}, é upgrade: ${isUpgrade}`);
          break;
        }
      }
    } catch (subscriptionError: any) {
      console.warn(`[create-checkout] Aviso: Erro ao buscar assinaturas existentes: ${subscriptionError?.message}`);
      // Continuar com criação de nova assinatura se houver erro
    }

    // Se existe assinatura ativa do mesmo tipo e é um plano diferente, fazer upgrade/downgrade
    if (existingSubscription && isUpgrade) {
      console.log(`[create-checkout] Fazendo upgrade/downgrade da assinatura ${existingSubscription.id}`);
      
      try {
        // Obter o subscription item ID
        const subscriptionItemId = existingSubscription.items.data[0]?.id;
        if (!subscriptionItemId) {
          throw new Error("Subscription item não encontrado");
        }

        // Atualizar a assinatura com o novo preço
        // O Stripe automaticamente faz prorating (cálculo proporcional)
        const updatedSubscription = await stripe.subscriptions.update(existingSubscription.id, {
          items: [{
            id: subscriptionItemId,
            price: priceId,
          }],
          metadata: {
            user_id: user.id,
            plan_id: requestData.planId,
            voucher_code: requestData.voucherCode || undefined,
          },
          proration_behavior: 'always_invoice', // Sempre criar invoice com prorating
        });

        console.log(`[create-checkout] Assinatura atualizada com sucesso: ${updatedSubscription.id}`);
        console.log(`[create-checkout] Próxima cobrança: ${new Date(updatedSubscription.current_period_end * 1000).toISOString()}`);

        // Se houver invoice pendente (do prorating), redirecionar para página de pagamento
        if (updatedSubscription.latest_invoice) {
          const invoiceId = typeof updatedSubscription.latest_invoice === 'string' 
            ? updatedSubscription.latest_invoice 
            : updatedSubscription.latest_invoice.id;
          
          const invoice = await stripe.invoices.retrieve(invoiceId);
          
          // Se a invoice tem valor e não está paga, redirecionar para página de pagamento
          if (invoice.amount_due > 0 && invoice.status !== 'paid') {
            const invoiceUrl = invoice.hosted_invoice_url;
            if (invoiceUrl) {
              console.log(`[create-checkout] Redirecionando para pagamento da invoice: ${invoiceUrl}`);
              return new Response(
                JSON.stringify({ 
                  url: invoiceUrl,
                  session_id: updatedSubscription.id,
                  is_upgrade: true
                }),
                {
                  status: 200,
                  headers: { ...corsHeaders, "Content-Type": "application/json" }
                }
              );
            }
          }
        }

        // Se não há cobrança pendente (downgrade com crédito), redirecionar para success
        console.log(`[create-checkout] Upgrade/downgrade concluído sem cobrança imediata`);
        return new Response(
          JSON.stringify({ 
            url: successUrl,
            session_id: updatedSubscription.id,
            is_upgrade: true,
            message: "Plano atualizado com sucesso"
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );

      } catch (upgradeError: any) {
        console.error(`[create-checkout] Erro ao fazer upgrade/downgrade:`, upgradeError);
        // Se falhar o upgrade, continuar com criação de nova assinatura
        console.log(`[create-checkout] Continuando com criação de nova assinatura...`);
      }
    }
    
    console.log(`[create-checkout] Criando sessão de checkout com:`, {
      priceId,
      mode: "subscription",
      successUrl,
      cancelUrl,
      customerId,
      customerEmail: user.email ? `${user.email.substring(0, 3)}***` : "none",
      voucherCode: requestData.voucherCode || 'nenhum'
    });
    
    // Validar voucher de desconto se fornecido
    let discountCoupons: string[] | undefined = undefined;
    if (requestData.voucherCode) {
      try {
        console.log(`[create-checkout] Validando voucher de desconto: ${requestData.voucherCode}`);
        const { data: voucherData, error: voucherError } = await supabase
          .rpc('validate_discount_voucher', {
            voucher_code_param: requestData.voucherCode.trim().toUpperCase()
          });
        
        if (voucherError) {
          console.error(`[create-checkout] Erro ao validar voucher:`, voucherError);
          throw new Error(`Voucher inválido: ${voucherError.message}`);
        }
        
        if (!voucherData || !voucherData.valid) {
          throw new Error("Voucher de desconto inválido ou expirado");
        }
        
        console.log(`[create-checkout] Voucher válido:`, voucherData);
        
        // Criar um Promotion Code no Stripe baseado no voucher
        // Stripe usa Promotion Codes para descontos em checkout
        const discountType = voucherData.discount_type;
        const discountValue = parseFloat(voucherData.discount_value);
        
        // Criar cupom no Stripe
        const stripeCoupon = await stripe.coupons.create({
          ...(discountType === 'percentage' 
            ? { percent_off: discountValue }
            : { amount_off: Math.round(discountValue * 100), currency: 'brl' }),
          duration: 'once', // Aplicar apenas no primeiro pagamento
          name: `Voucher ${requestData.voucherCode}`,
        });
        
        console.log(`[create-checkout] Cupom Stripe criado: ${stripeCoupon.id}`);
        discountCoupons = [stripeCoupon.id];
        
      } catch (voucherError: any) {
        console.error(`[create-checkout] Erro ao processar voucher:`, voucherError);
        // Não falhar o checkout, apenas logar o erro
        // O usuário pode tentar novamente sem voucher
        return new Response(
          JSON.stringify({ 
            error: "Invalid Voucher",
            details: voucherError.message || "Voucher de desconto inválido" 
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }
    }
    
    // Criar sessão de checkout no Stripe
    let session;
    try {
      const sessionParams: any = {
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer: customerId,
        metadata: {
          user_id: user.id,
          plan_id: requestData.planId,
          voucher_code: requestData.voucherCode || undefined,
        },
        subscription_data: {
          metadata: {
            user_id: user.id,
            plan_id: requestData.planId,
            voucher_code: requestData.voucherCode || undefined,
          },
        },
        payment_method_types: ["card"],
        // Desabilitar Stripe Link e forçar apenas cartão de crédito
        payment_method_options: {
          card: {
            request_three_d_secure: "automatic",
          },
        },
        // Garantir que apenas cartão seja coletado (desabilita Link)
        payment_method_collection: "always",
      };
      
      // Adicionar cupons de desconto se houver
      if (discountCoupons && discountCoupons.length > 0) {
        sessionParams.discounts = discountCoupons.map(coupon => ({ coupon }));
        console.log(`[create-checkout] Aplicando desconto com cupons:`, discountCoupons);
      }
      
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (stripeError: any) {
      console.error("[create-checkout] Erro ao criar sessão no Stripe:", {
        error: stripeError,
        message: stripeError?.message,
        type: stripeError?.type,
        code: stripeError?.code,
        statusCode: stripeError?.statusCode,
        raw: stripeError?.raw
      });
      
      // Tratamento específico para erros comuns do Stripe
      let errorMessage = stripeError?.message || "Erro desconhecido ao criar sessão no Stripe";
      
      if (stripeError?.message?.includes("cannot currently make live charges")) {
        errorMessage = "Conta Stripe não habilitada para modo live. Use chave de teste (sk_test_) ou complete a verificação da conta no Stripe Dashboard.";
        console.error("[create-checkout] ERRO CRÍTICO:", errorMessage);
      } else if (stripeError?.message?.includes("No such price")) {
        errorMessage = `Price ID não encontrado no Stripe. Verifique se o Price ID existe no modo correto (teste ou live). Price usado: ${priceId}`;
        console.error("[create-checkout] ERRO CRÍTICO:", {
          errorMessage,
          priceId,
          stripeKeyPrefix: stripeSecretKey.substring(0, 12),
          detectedMode: isTestMode ? "TESTE" : "PRODUÇÃO",
          planId: requestData.planId,
          availablePrices: Object.entries(STRIPE_PRICES).map(([plan, price]) => `${plan}: ${price}`)
        });
      } else if (stripeError?.code === "resource_missing") {
        errorMessage = `Recurso não encontrado no Stripe: ${stripeError?.param || "desconhecido"}. Verifique se está usando os IDs corretos para o modo (teste/live).`;
        console.error("[create-checkout] ERRO CRÍTICO:", errorMessage);
      }
      
      throw new Error(`Erro do Stripe: ${errorMessage}`);
    }
    
    console.log(`[create-checkout] Checkout session created: ${session.id} for user ${user.id}`);
    
    if (!session.url) {
      console.error("[create-checkout] Sessão criada mas sem URL:", {
        sessionId: session.id,
        hasUrl: !!session.url
      });
      throw new Error("URL de checkout não foi gerada pelo Stripe");
    }
    
    return new Response(
      JSON.stringify({ 
        url: session.url,
        session_id: session.id
      }),
      {
      status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error("[create-checkout] Unhandled error:", {
      message: errorMessage,
      stack: errorStack,
      error: error
    });
    
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: errorMessage
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
