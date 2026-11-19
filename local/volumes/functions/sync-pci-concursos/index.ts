/**
 * Sincroniza concursos abertos do PCI (/concursos/) para pci_concurso_feed.
 * Apenas administradores autenticados (JWT + user_roles).
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchPciConcursosHtml,
  parsePciConcursosHtml,
  type PciParsedItem,
} from "../_shared/pci-parser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAdmin(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  const { data: roleData, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError || !roleData) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  return null;
}

function toRow(item: PciParsedItem, scrapedAt: string) {
  return {
    id: item.id,
    titulo: item.titulo,
    regiao: item.regiao,
    uf: item.uf ?? null,
    vagas: item.vagas,
    vagas_texto: item.vagas_texto,
    salario_min: item.salario_min,
    salario_max: item.salario_max,
    salario_texto: item.salario_texto || null,
    cargos: item.cargos,
    escolaridade: item.escolaridade,
    resumo: item.resumo,
    inscricao_ate: item.inscricao_ate,
    inscricao_texto: item.inscricao_texto,
    status: item.status,
    is_active: true,
    scraped_at: scrapedAt,
    updated_at: scrapedAt,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authFailure = await requireAdmin(req);
  if (authFailure) return authFailure;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const runStarted = new Date().toISOString();
  const { data: runRow, error: runErr } = await supabase
    .from("pci_concurso_feed_sync_runs")
    .insert({ started_at: runStarted, status: "running" })
    .select("id")
    .single();

  if (runErr) {
    console.error("sync run insert failed", runErr);
  }

  const runId = runRow?.id;

  try {
    const html = await fetchPciConcursosHtml();
    const parsed = parsePciConcursosHtml(html);
    const byId = new Map<string, (typeof parsed)[0]>();
    for (const item of parsed) {
      byId.set(item.id, item);
    }
    const items = [...byId.values()];
    const scrapedAt = new Date().toISOString();
    const ids = new Set(items.map((i) => i.id));

    const BATCH = 100;
    let upserted = 0;
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH).map((item) => toRow(item, scrapedAt));
      const { error } = await supabase.from("pci_concurso_feed").upsert(batch, { onConflict: "id" });
      if (error) throw error;
      upserted += batch.length;
    }

    const { data: activeRows } = await supabase
      .from("pci_concurso_feed")
      .select("id")
      .eq("is_active", true);

    const toDeactivate = (activeRows || []).filter((r) => !ids.has(r.id)).map((r) => r.id);
    let deactivated = 0;
    if (toDeactivate.length > 0) {
      for (let i = 0; i < toDeactivate.length; i += BATCH) {
        const chunk = toDeactivate.slice(i, i + BATCH);
        const { error } = await supabase
          .from("pci_concurso_feed")
          .update({ is_active: false, updated_at: scrapedAt })
          .in("id", chunk);
        if (error) throw error;
        deactivated += chunk.length;
      }
    }

    if (runId) {
      await supabase
        .from("pci_concurso_feed_sync_runs")
        .update({
          finished_at: scrapedAt,
          status: "ok",
          items_upserted: upserted,
          items_deactivated: deactivated,
        })
        .eq("id", runId);
    }

    return jsonResponse({
      ok: true,
      scrapedAt,
      total: items.length,
      upserted,
      deactivated,
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await supabase
        .from("pci_concurso_feed_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          error_message: message,
        })
        .eq("id", runId);
    }
    return jsonResponse({ error: message }, 500);
  }
});
