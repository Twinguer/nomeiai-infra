/**
 * Edge Function: serve-document
 * 
 * Descrição: Serve documentos de estudo (PDFs/imagens) de forma segura usando tokens
 * Autenticação: Requer token seguro válido via query parameter
 * Rate Limiting: 20 requisições por minuto por token
 * 
 * Fluxo:
 * 1. Recebe token via query parameter
 * 2. Aplica rate limiting por token
 * 3. Valida token usando resolve_secure_token RPC
 * 4. Verifica permissões (usuário tem acesso ao ciclo?)
 * 5. Busca arquivo do storage usando filePath do metadata
 * 6. Serve arquivo com headers apropriados
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "./rateLimiter.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    // Obter token da query string
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Token missing' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Criar cliente Supabase com service role para acessar RPCs
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ✅ RATE LIMITING: Limitar requisições por token (20 por minuto)
    const rateLimitResult = await checkRateLimit(
      `token:${token}`,
      {
        maxRequests: 20,
        windowMs: 60 * 1000, // 1 minuto
        keyPrefix: 'serve_document'
      }
    );

    if (!rateLimitResult.allowed) {
      const resetTime = new Date(rateLimitResult.resetAt).toISOString();
      return new Response(
        JSON.stringify({ 
          error: 'Rate limit exceeded',
          message: 'Muitas requisições. Tente novamente mais tarde.',
          resetAt: resetTime
        }),
        {
          status: 429,
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': '20',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': resetTime,
            'Retry-After': '60'
          },
        }
      );
    }

    // Validar token usando RPC
    const { data: tokenData, error: tokenError } = await supabase.rpc('resolve_secure_token', {
      p_token_hash: token
    });

    if (tokenError || !tokenData) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Verificar se é um documento de estudo
    if (tokenData.entity_type !== 'study_document') {
      return new Response(
        JSON.stringify({ error: 'Invalid token type' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Extrair metadata (filePath e cycleId)
    const metadata = tokenData.metadata || {};
    const filePath = metadata.filePath as string;
    const cycleId = metadata.cycleId as string;
    const userId = tokenData.entity_id as string;

    if (!filePath || !cycleId) {
      return new Response(
        JSON.stringify({ error: 'Invalid token metadata' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Verificar se o usuário tem acesso ao ciclo
    console.log('[serve-document] Verificando acesso:', { cycleId, userId });
    
    // Primeiro, tentar buscar na tabela study_cycles_v2 (estrutura nova)
    const { data: cycleV2, error: cycleV2Error } = await supabase
      .from('study_cycles_v2')
      .select('id, user_id')
      .eq('id', cycleId)
      .eq('user_id', userId)
      .maybeSingle();

    console.log('[serve-document] Resultado study_cycles_v2:', { 
      found: !!cycleV2, 
      error: cycleV2Error?.message || null 
    });

    let hasAccess = false;

    // Se encontrou na tabela V2, usuário tem acesso
    if (cycleV2 && !cycleV2Error) {
      console.log('[serve-document] ✅ Acesso confirmado via study_cycles_v2');
      hasAccess = true;
    } else {
      // Fallback: verificar na estrutura antiga (user_study_v2.study_cycles JSONB)
      console.log('[serve-document] Tentando fallback para user_study_v2...');
      
      const { data: userStudy, error: userStudyError } = await supabase
        .from('user_study_v2')
        .select('study_cycles')
        .eq('user_id', userId)
        .maybeSingle();

      if (userStudyError) {
        console.error('[serve-document] ❌ Erro ao buscar user_study_v2:', userStudyError);
        return new Response(
          JSON.stringify({ 
            error: 'Error checking access',
            details: userStudyError.message 
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      if (!userStudy) {
        console.error('[serve-document] ❌ user_study_v2 não encontrado para userId:', userId);
        return new Response(
          JSON.stringify({ error: 'User study data not found' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Verificar se o ciclo existe no JSONB
      const cycles = userStudy.study_cycles as any[];
      console.log('[serve-document] Ciclos encontrados:', cycles?.length || 0);
      
      if (!cycles || !Array.isArray(cycles)) {
        console.error('[serve-document] ❌ study_cycles não é array:', typeof cycles);
        return new Response(
          JSON.stringify({ error: 'Cycle not found - invalid data structure' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const cycle = cycles.find((c: any) => c.id === cycleId);
      console.log('[serve-document] Ciclo procurado:', cycleId);
      console.log('[serve-document] Ciclo encontrado:', !!cycle);

      if (!cycle) {
        console.error('[serve-document] ❌ Ciclo não encontrado no JSONB. IDs disponíveis:', 
          cycles.map((c: any) => c.id).slice(0, 5)
        );
        return new Response(
          JSON.stringify({ 
            error: 'Cycle not found',
            cycleId,
            availableCycles: cycles.length
          }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Se chegou aqui, o ciclo existe e pertence ao usuário (já filtramos por user_id na query)
      console.log('[serve-document] ✅ Acesso confirmado via user_study_v2 JSONB');
      hasAccess = true;
    }

    // Verificar se tem acesso
    if (!hasAccess) {
      console.error('[serve-document] ❌ Acesso negado - hasAccess = false');
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    console.log('[serve-document] ✅ Acesso confirmado, buscando arquivo...');

    // Buscar arquivo do storage
    const { data: fileData, error: fileError } = await supabase.storage
      .from('profiles')
      .download(filePath);

    if (fileError || !fileData) {
      console.error('Error downloading file:', fileError);
      return new Response(
        JSON.stringify({ error: 'File not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Determinar content-type baseado na extensão do arquivo
    const fileExtension = filePath.split('.').pop()?.toLowerCase();
    let contentType = 'application/octet-stream';
    
    if (fileExtension === 'pdf') {
      contentType = 'application/pdf';
    } else if (['jpg', 'jpeg'].includes(fileExtension || '')) {
      contentType = 'image/jpeg';
    } else if (fileExtension === 'png') {
      contentType = 'image/png';
    } else if (fileExtension === 'gif') {
      contentType = 'image/gif';
    } else if (fileExtension === 'webp') {
      contentType = 'image/webp';
    }

    // Converter blob para array buffer
    const arrayBuffer = await fileData.arrayBuffer();

    // Retornar arquivo com headers apropriados
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filePath.split('/').pop()}"`,
        'Cache-Control': 'private, max-age=3600', // Cache por 1 hora
        'X-RateLimit-Limit': '20',
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimitResult.resetAt).toISOString(),
      },
    });

  } catch (error) {
    console.error('Error serving document:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
