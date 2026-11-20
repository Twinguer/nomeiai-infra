/**
 * Rate Limiter para Edge Function serve-document
 * 
 * Implementa rate limiting usando tabela rate_limits no Supabase
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number; // Janela de tempo em milissegundos
  keyPrefix: string; // Prefixo para a chave de cache
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Timestamp quando o limite será resetado
}

/**
 * Cria uma chave única para rate limiting
 */
function createRateLimitKey(
  identifier: string,
  config: RateLimitConfig
): string {
  return `rate_limit:${config.keyPrefix}:${identifier}`;
}

/**
 * Verifica e aplica rate limiting
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseServiceKey) {
    // Se não houver configuração, permitir (fallback para desenvolvimento)
    console.warn('[rateLimiter] Supabase config não encontrada, rate limiting desabilitado');
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: Date.now() + config.windowMs
    };
  }

  const supabase = await import('https://esm.sh/@supabase/supabase-js@2').then(
    m => m.createClient(supabaseUrl, supabaseServiceKey)
  );

  const key = createRateLimitKey(identifier, config);
  const now = Date.now();
  const resetAt = now + config.windowMs;

  try {
    // Buscar registro existente
    const { data: existing, error: fetchError } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('key', key)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found
      console.error('[rateLimiter] Erro ao buscar rate limit:', fetchError);
      // Em caso de erro, permitir (fail open)
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetAt
      };
    }

    // Se não existe ou expirou, criar novo registro
    const expiresAtTime = existing ? new Date(existing.expires_at).getTime() : 0;
    if (!existing || expiresAtTime < now) {
      const { error: upsertError } = await supabase
        .from('rate_limits')
        .upsert({
          key,
          count: 1,
          expires_at: new Date(resetAt).toISOString(),
          created_at: new Date().toISOString()
        }, {
          onConflict: 'key'
        });

      if (upsertError) {
        console.error('[rateLimiter] Erro ao criar rate limit:', upsertError);
        return {
          allowed: true,
          remaining: config.maxRequests,
          resetAt
        };
      }

      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt
      };
    }

    // Verificar se excedeu o limite
    if (existing.count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: expiresAtTime
      };
    }

    // Incrementar contador
    const { error: updateError } = await supabase
      .from('rate_limits')
      .update({
        count: existing.count + 1
      })
      .eq('key', key);

    if (updateError) {
      console.error('[rateLimiter] Erro ao atualizar rate limit:', updateError);
      return {
        allowed: true,
        remaining: config.maxRequests - existing.count,
        resetAt: new Date(existing.expires_at).getTime()
      };
    }

    return {
      allowed: true,
      remaining: config.maxRequests - existing.count - 1,
      resetAt: new Date(existing.expires_at).getTime()
    };

  } catch (error) {
    console.error('[rateLimiter] Erro inesperado:', error);
    // Fail open em caso de erro
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt
    };
  }
}
