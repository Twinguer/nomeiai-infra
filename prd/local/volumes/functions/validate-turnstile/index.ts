import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TURNSTILE_SECRET = Deno.env.get('TURNSTILE_SECRET_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const { token } = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Token missing' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Obter chave secreta (prioridade: env > banco de dados)
    let secretKey = TURNSTILE_SECRET;
    
    if (!secretKey) {
      // Tentar obter do banco de dados
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      
      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data: config } = await supabase
          .from('app_config')
          .select('value')
          .eq('key', 'turnstile_secret_key')
          .single();
        
        if (config?.value) {
          secretKey = config.value;
        }
      }
    }

    if (!secretKey) {
      console.error('TURNSTILE_SECRET_KEY not configured');
      // Em desenvolvimento, permitir sem validação se não houver chave
      if (Deno.env.get('ENVIRONMENT') === 'development' || Deno.env.get('ENV') === 'development') {
        return new Response(
          JSON.stringify({ valid: true, warning: 'Turnstile not configured in development' }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      return new Response(
        JSON.stringify({ valid: false, error: 'Turnstile not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Validar com Cloudflare Turnstile
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      console.error('Turnstile validation failed:', data['error-codes']);
    }

    return new Response(
      JSON.stringify({ 
        valid: data.success || false,
        errorCodes: data['error-codes'] || []
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error validating Turnstile:', error);
    return new Response(
      JSON.stringify({ 
        valid: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
