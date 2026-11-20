import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface MetricsResponse {
  timestamp: string;
  status: 'ok' | 'error';
  metrics: {
    // Métricas de usuários
    users: {
      total: number;
      online: number;
      active_24h: number;
      active_7d: number;
    };
    // Métricas de rankings
    rankings: {
      total: number;
      active: number;
      participations: number;
      participations_24h: number;
    };
    // Métricas de pontuações
    scores: {
      average: number;
      highest: number;
      lowest: number;
      total_scored: number;
    };
    // Métricas de estudos
    studies: {
      total_cycles: number;
      active_cycles: number;
      total_sessions: number;
      total_hours: number;
      questions_answered: number;
      correct_answers: number;
      accuracy_rate: number;
    };
    // Métricas de coach
    coach: {
      total_coaches: number;
      active_subscriptions: number;
      total_students: number;
      pending_invitations: number;
      access_logs_24h: number;
    };
    // Métricas de segurança
    security: {
      audit_logs_24h: number;
      security_logs_24h: number;
      total_security_events: number;
    };
    // Métricas de notificações
    notifications: {
      total: number;
      unread: number;
      created_24h: number;
    };
    // Métricas de performance
    performance: {
      avg_query_time_ms: number;
      slow_queries_count: number;
      active_alerts: number;
      critical_alerts: number;
    };
    // Métricas de sistema
    system: {
      health: 'healthy' | 'warning' | 'critical';
      engagement_rate: number;
      uptime_percentage: number;
    };
    // Métricas de assinaturas e pagamentos
    subscriptions: {
      user_subscriptions: {
        total: number;
        free: number;
        pro: number;
        pro_active: number;
        active: number;
        expiring_7d: number;
        new_24h: number;
        new_7d: number;
        new_30d: number;
      };
      coach_subscriptions: {
        total: number;
        active: number;
        starter: number;
        professional: number;
        enterprise: number;
        expiring_7d: number;
      };
      vouchers: {
        total: number;
        active: number;
        used: number;
        expiring_7d: number;
      };
      payments: {
        pending: number;
        approved_24h: number;
        approved_7d: number;
        rejected: number;
        success_rate: number;
      };
    };
    // Métricas de grupos de estudo
    study_groups: {
      total: number;
      active: number;
      archived: number;
      public: number;
      private: number;
      invite_only: number;
      total_members: number;
      created_24h: number;
      created_7d: number;
      members: {
        total: number;
        active: number;
        pending_invitations: number;
        pending_requests: number;
      };
      posts: {
        total: number;
        created_24h: number;
        created_7d: number;
      };
      comments: {
        total: number;
        created_24h: number;
        created_7d: number;
      };
    };
    // Métricas de conversão e onboarding
    conversion: {
      new_users: {
        registered_24h: number;
        registered_7d: number;
        registered_30d: number;
        growth_rate: number;
      };
      engagement: {
        completed_profile: number;
        participated_ranking: number;
        created_study_cycle: number;
        joined_group: number;
      };
      retention: {
        d1_retention: number;
        d7_retention: number;
        d30_retention: number;
        churn_rate: number;
      };
    };
    // Métricas de respostas de provas
    answers: {
      total_submitted: number;
      submitted_24h: number;
      submitted_7d: number;
      edit_rate: number;
      by_concurso: number;
    };
    // Métricas de concursos (melhoradas)
    concursos: {
      by_status: {
        em_andamento: number;
        finalizado: number;
        inativo: number;
      };
      created: {
        created_24h: number;
        created_7d: number;
        created_30d: number;
      };
      avg_participation_rate: number;
    };
    pci_feed: {
      active_count: number;
      last_scraped_at: string | null;
      last_sync: {
        status: string;
        started_at: string;
        finished_at: string | null;
        items_upserted: number | null;
        items_deactivated: number | null;
        error_message: string | null;
      } | null;
    };
  };
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        status: 405, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }

  try {
    // ============================================
    // VERIFICAÇÃO DE AUTENTICAÇÃO E PERMISSÕES
    // ============================================
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    // Obter token JWT do header Authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Missing or invalid authorization header' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Criar cliente com token do usuário para verificar autenticação
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    // Verificar se o token é válido e obter usuário
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid or expired token' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Verificar se o usuário tem papel de administrador
    // Usar service role para verificar user_roles (RLS pode bloquear)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: roleData, error: roleError } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (roleError || !roleData) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Admin access required' }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // ============================================
    // USUÁRIO É ADMIN - CONTINUAR COM MÉTRICAS
    // Criar cliente com service role para acessar todos os dados
    // ============================================
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // ============================================
    // 1. MÉTRICAS DE USUÁRIOS
    // ============================================
    const { count: totalUsers } = await supabase
      .from('users_profiles')
      .select('*', { count: 'exact', head: true });

    const { count: onlineUsers } = await supabase
      .from('users_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_online', true);

    const { count: active24h } = await supabase
      .from('users_profiles')
      .select('*', { count: 'exact', head: true })
      .gte('last_activity', yesterday.toISOString());

    const { count: active7d } = await supabase
      .from('users_profiles')
      .select('*', { count: 'exact', head: true })
      .gte('last_activity', weekAgo.toISOString());

    // ============================================
    // 2. MÉTRICAS DE RANKINGS
    // ============================================
    const { count: totalRankings } = await supabase
      .from('concursos')
      .select('*', { count: 'exact', head: true });

    const { count: activeRankings } = await supabase
      .from('concursos')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Em andamento');

    const { count: totalParticipations } = await supabase
      .from('user_rankings')
      .select('*', { count: 'exact', head: true });

    const { count: participations24h } = await supabase
      .from('user_rankings')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yesterday.toISOString());

    // ============================================
    // 3. MÉTRICAS DE PONTUAÇÕES
    // ============================================
    let averageScore = 0;
    let highestScore = 0;
    let lowestScore = 0;
    let totalScored = 0;

    try {
      const { data: scoreData } = await supabase
        .from('user_rankings')
        .select('score')
        .not('score', 'is', null);

      if (scoreData && scoreData.length > 0) {
        const scores = scoreData
          .map(r => typeof r.score === 'number' ? r.score : parseFloat(r.score || '0'))
          .filter(s => !isNaN(s) && s >= 0);

        if (scores.length > 0) {
          totalScored = scores.length;
          averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
          highestScore = Math.max(...scores);
          lowestScore = Math.min(...scores);
        }
      }
    } catch (error) {
      console.warn('[metrics] Error fetching scores:', error);
    }

    // ============================================
    // 4. MÉTRICAS DE ESTUDOS
    // ============================================
    let totalCycles = 0;
    let activeCycles = 0;
    let totalSessions = 0;
    let totalHours = 0;
    let questionsAnswered = 0;
    let correctAnswers = 0;

    try {
      // Contar ciclos de estudos
      const { count: cyclesCount } = await supabase
        .from('study_cycles_v2')
        .select('*', { count: 'exact', head: true });

      totalCycles = cyclesCount || 0;

      // Contar ciclos ativos (últimos 30 dias)
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const { count: activeCyclesCount } = await supabase
        .from('study_cycles_v2')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', thirtyDaysAgo.toISOString());

      activeCycles = activeCyclesCount || 0;

      // Buscar estatísticas agregadas de estudos
      const { data: studyStats } = await supabase
        .from('study_statistics')
        .select('statistics_data');

      if (studyStats && studyStats.length > 0) {
        studyStats.forEach(stat => {
          const data = stat.statistics_data;
          if (data) {
            totalSessions += typeof data.totalSessions === 'number' ? data.totalSessions : 0;
            totalHours += typeof data.totalHours === 'number' ? data.totalHours : 0;
            questionsAnswered += typeof data.questionsAnswered === 'number' ? data.questionsAnswered : 0;
            correctAnswers += typeof data.correctAnswers === 'number' ? data.correctAnswers : 0;
          }
        });
      }

      // Alternativa: buscar de user_study_v2 se study_statistics não tiver dados
      if (totalSessions === 0) {
        const { data: userStudyData } = await supabase
          .from('user_study_v2')
          .select('study_sessions');

        if (userStudyData) {
          userStudyData.forEach(user => {
            const sessions = user.study_sessions;
            if (Array.isArray(sessions)) {
              totalSessions += sessions.length;
              sessions.forEach((session: any) => {
                if (session.duration_minutes) {
                  totalHours += (session.duration_minutes || 0) / 60;
                }
                if (session.questions) {
                  questionsAnswered += session.questions || 0;
                }
                if (session.correct_answers) {
                  correctAnswers += session.correct_answers || 0;
                }
              });
            }
          });
        }
      }
    } catch (error) {
      console.warn('[metrics] Error fetching study metrics:', error);
    }

    const accuracyRate = questionsAnswered > 0 
      ? Math.round((correctAnswers / questionsAnswered) * 100 * 100) / 100
      : 0;

    // ============================================
    // 5. MÉTRICAS DE COACH
    // ============================================
    let totalCoaches = 0;
    let activeSubscriptions = 0;
    let totalStudents = 0;
    let pendingInvitations = 0;
    let accessLogs24h = 0;

    try {
      const { count: coachesCount } = await supabase
        .from('coach_profiles')
        .select('*', { count: 'exact', head: true });

      totalCoaches = coachesCount || 0;

      const { count: subscriptionsCount } = await supabase
        .from('coach_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      activeSubscriptions = subscriptionsCount || 0;

      // Contar alunos totais (somar current_students de todas as assinaturas)
      const { data: subscriptions } = await supabase
        .from('coach_subscriptions')
        .select('current_students')
        .eq('status', 'active');

      if (subscriptions) {
        totalStudents = subscriptions.reduce((sum, sub) => {
          return sum + (typeof sub.current_students === 'number' ? sub.current_students : 0);
        }, 0);
      }

      // Contar convites pendentes (agregar de coach_profiles)
      const { data: coachProfiles } = await supabase
        .from('coach_profiles')
        .select('pending_invitations');

      if (coachProfiles) {
        coachProfiles.forEach(profile => {
          const invitations = profile.pending_invitations;
          if (Array.isArray(invitations)) {
            pendingInvitations += invitations.length;
          }
        });
      }

      // Contar logs de acesso (últimas 24h)
      const { count: logsCount } = await supabase
        .from('coach_access_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday.toISOString());

      accessLogs24h = logsCount || 0;
    } catch (error) {
      console.warn('[metrics] Error fetching coach metrics:', error);
    }

    // ============================================
    // 6. MÉTRICAS DE SEGURANÇA
    // ============================================
    let auditLogs24h = 0;
    let securityLogs24h = 0;
    let totalSecurityEvents = 0;

    try {
      const { count: auditCount } = await supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday.toISOString());

      auditLogs24h = auditCount || 0;

      const { count: securityCount } = await supabase
        .from('security_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday.toISOString());

      securityLogs24h = securityCount || 0;

      const { count: totalSecurityCount } = await supabase
        .from('security_logs')
        .select('*', { count: 'exact', head: true });

      totalSecurityEvents = totalSecurityCount || 0;
    } catch (error) {
      console.warn('[metrics] Error fetching security metrics:', error);
    }

    // ============================================
    // 7. MÉTRICAS DE NOTIFICAÇÕES
    // ============================================
    let totalNotifications = 0;
    let unreadNotifications = 0;
    let notifications24h = 0;

    try {
      const { count: notificationsCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true });

      totalNotifications = notificationsCount || 0;

      const { count: unreadCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);

      unreadNotifications = unreadCount || 0;

      const { count: notificationsCount24h } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday.toISOString());

      notifications24h = notificationsCount24h || 0;
    } catch (error) {
      console.warn('[metrics] Error fetching notification metrics:', error);
    }

    // ============================================
    // 8. MÉTRICAS DE PERFORMANCE
    // ============================================
    let avgQueryTime = 0;
    let slowQueriesCount = 0;
    
    try {
      const { data: queryLogs } = await supabase
        .from('query_performance_logs')
        .select('execution_time_ms')
        .order('created_at', { ascending: false })
        .limit(100);

      if (queryLogs && queryLogs.length > 0) {
        const times = queryLogs
          .map(log => log.execution_time_ms)
          .filter(time => time !== null && time !== undefined) as number[];
        
        if (times.length > 0) {
          avgQueryTime = times.reduce((sum, time) => sum + time, 0) / times.length;
          slowQueriesCount = times.filter(time => time > 1000).length;
        }
      }
    } catch (error) {
      console.warn('[metrics] Error fetching query performance logs:', error);
    }

    let activeAlertsCount = 0;
    let criticalAlertsCount = 0;
    
    try {
      const { data: alerts } = await supabase
        .from('performance_alerts')
        .select('severity, is_resolved')
        .eq('is_resolved', false);

      if (alerts) {
        activeAlertsCount = alerts.length;
        criticalAlertsCount = alerts.filter(a => a.severity === 'critical').length;
      }
    } catch (error) {
      console.warn('[metrics] Error fetching performance alerts:', error);
    }

    // ============================================
    // 9. MÉTRICAS DE SISTEMA
    // ============================================
    const userEngagement = totalUsers && totalUsers > 0
      ? Math.round((active24h || 0) / totalUsers * 100)
      : 0;

    let systemHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (userEngagement < 10 || criticalAlertsCount > 0) {
      systemHealth = 'critical';
    } else if (userEngagement < 30 || activeAlertsCount > 5) {
      systemHealth = 'warning';
    }

    // Calcular uptime (simplificado - baseado em métricas de performance)
    const uptimePercentage = avgQueryTime < 500 && systemHealth === 'healthy' ? 99.9 : 
                            avgQueryTime < 1000 && systemHealth !== 'critical' ? 99.5 : 95.0;

    // ============================================
    // 10. MÉTRICAS DE ASSINATURAS E PAGAMENTOS
    // ============================================
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    let userSubsTotal = 0;
    let userSubsFree = 0;
    let userSubsPro = 0;
    let userSubsProActive = 0;
    let userSubsActive = 0;
    let userSubsExpiring7d = 0;
    let userSubsNew24h = 0;
    let userSubsNew7d = 0;
    let userSubsNew30d = 0;

    try {
      const { count: totalUserSubs } = await supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true });
      userSubsTotal = totalUserSubs || 0;

      const { count: freeSubs } = await supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('plan', 'free');
      userSubsFree = freeSubs || 0;

      const { count: proSubs } = await supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('plan', 'pro');
      userSubsPro = proSubs || 0;

      const { count: proActiveSubs } = await supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('plan', 'pro')
        .eq('is_active', true);
      userSubsProActive = proActiveSubs || 0;

      const { count: activeUserSubs } = await supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      userSubsActive = activeUserSubs || 0;

      const { count: expiringUserSubs } = await supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .gte('expires_at', now.toISOString())
        .lte('expires_at', sevenDaysFromNow.toISOString());
      userSubsExpiring7d = expiringUserSubs || 0;

      const { count: newUserSubs24h } = await supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday.toISOString());
      userSubsNew24h = newUserSubs24h || 0;

      const { count: newUserSubs7d } = await supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekAgo.toISOString());
      userSubsNew7d = newUserSubs7d || 0;

      const { count: newUserSubs30d } = await supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', thirtyDaysAgo.toISOString());
      userSubsNew30d = newUserSubs30d || 0;
    } catch (error) {
      console.warn('[metrics] Error fetching user subscriptions:', error);
    }

    let coachSubsTotal = 0;
    let coachSubsActive = 0;
    let coachSubsStarter = 0;
    let coachSubsProfessional = 0;
    let coachSubsEnterprise = 0;
    let coachSubsExpiring7d = 0;

    try {
      const { count: totalCoachSubs } = await supabase
        .from('coach_subscriptions')
        .select('*', { count: 'exact', head: true });
      coachSubsTotal = totalCoachSubs || 0;

      const { count: activeCoachSubs } = await supabase
        .from('coach_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      coachSubsActive = activeCoachSubs || 0;

      const { data: coachSubsData } = await supabase
        .from('coach_subscriptions')
        .select('plan_type, status, expires_at');

      if (coachSubsData) {
        coachSubsData.forEach(sub => {
          if (sub.status === 'active') {
            const plan = sub.plan_type;
            if (plan === 'starter') {
              coachSubsStarter++;
            } else if (plan === 'professional') {
              coachSubsProfessional++;
            } else if (plan === 'enterprise') {
              coachSubsEnterprise++;
            }
            if (sub.expires_at) {
              const expiresAt = new Date(sub.expires_at);
              if (expiresAt >= now && expiresAt <= sevenDaysFromNow) {
                coachSubsExpiring7d++;
              }
            }
          }
        });
      }
    } catch (error) {
      console.warn('[metrics] Error fetching coach subscriptions:', error);
    }

    let vouchersTotal = 0;
    let vouchersActive = 0;
    let vouchersUsed = 0;
    let vouchersExpiring7d = 0;

    try {
      const { count: totalVouchers } = await supabase
        .from('vouchers')
        .select('*', { count: 'exact', head: true });
      vouchersTotal = totalVouchers || 0;

      const { count: activeVouchers } = await supabase
        .from('vouchers')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      vouchersActive = activeVouchers || 0;

      const { data: vouchersData } = await supabase
        .from('vouchers')
        .select('uses_count, max_uses, expires_at, is_active');

      if (vouchersData) {
        vouchersData.forEach(voucher => {
          if (voucher.uses_count && voucher.max_uses && voucher.uses_count >= voucher.max_uses) {
            vouchersUsed++;
          }
          if (voucher.is_active && voucher.expires_at) {
            const expiresAt = new Date(voucher.expires_at);
            if (expiresAt >= now && expiresAt <= sevenDaysFromNow) {
              vouchersExpiring7d++;
            }
          }
        });
      }
    } catch (error) {
      console.warn('[metrics] Error fetching vouchers:', error);
    }

    let paymentsPending = 0;
    let paymentsApproved24h = 0;
    let paymentsApproved7d = 0;
    let paymentsRejected = 0;
    let paymentSuccessRate = 0;

    try {
      const { count: pendingPayments } = await supabase
        .from('payment_preferences')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      paymentsPending = pendingPayments || 0;

      const { count: approved24h } = await supabase
        .from('payment_preferences')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved')
        .gte('updated_at', yesterday.toISOString());
      paymentsApproved24h = approved24h || 0;

      const { count: approved7d } = await supabase
        .from('payment_preferences')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved')
        .gte('updated_at', weekAgo.toISOString());
      paymentsApproved7d = approved7d || 0;

      const { count: rejectedPayments } = await supabase
        .from('payment_preferences')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'rejected');
      paymentsRejected = rejectedPayments || 0;

      const { data: allPayments } = await supabase
        .from('payment_preferences')
        .select('status');

      if (allPayments && allPayments.length > 0) {
        const approved = allPayments.filter(p => p.status === 'approved').length;
        paymentSuccessRate = Math.round((approved / allPayments.length) * 100 * 100) / 100;
      }
    } catch (error) {
      console.warn('[metrics] Error fetching payments:', error);
    }

    // ============================================
    // 11. MÉTRICAS DE GRUPOS DE ESTUDO
    // ============================================
    let studyGroupsTotal = 0;
    let studyGroupsActive = 0;
    let studyGroupsArchived = 0;
    let studyGroupsPublic = 0;
    let studyGroupsPrivate = 0;
    let studyGroupsInviteOnly = 0;
    let studyGroupsTotalMembers = 0;
    let studyGroupsCreated24h = 0;
    let studyGroupsCreated7d = 0;
    let groupMembersTotal = 0;
    let groupMembersActive = 0;
    let groupMembersPendingInvitations = 0;
    let groupMembersPendingRequests = 0;
    let groupPostsTotal = 0;
    let groupPostsCreated24h = 0;
    let groupPostsCreated7d = 0;
    let groupCommentsTotal = 0;
    let groupCommentsCreated24h = 0;
    let groupCommentsCreated7d = 0;

    try {
      const { count: totalGroups } = await supabase
        .from('study_groups')
        .select('*', { count: 'exact', head: true });
      studyGroupsTotal = totalGroups || 0;

      const { count: activeGroups } = await supabase
        .from('study_groups')
        .select('*', { count: 'exact', head: true })
        .eq('archived', false);
      studyGroupsActive = activeGroups || 0;

      const { count: archivedGroups } = await supabase
        .from('study_groups')
        .select('*', { count: 'exact', head: true })
        .eq('archived', true);
      studyGroupsArchived = archivedGroups || 0;

      const { data: groupsData } = await supabase
        .from('study_groups')
        .select('privacy_level, current_members, posts_data, created_at, archived');

      if (groupsData) {
        groupsData.forEach(group => {
          if (!group.archived) {
            if (group.privacy_level === 'public') studyGroupsPublic++;
            else if (group.privacy_level === 'private') studyGroupsPrivate++;
            else if (group.privacy_level === 'invite_only') studyGroupsInviteOnly++;

            studyGroupsTotalMembers += group.current_members || 0;

            const createdAt = new Date(group.created_at);
            if (createdAt >= yesterday) studyGroupsCreated24h++;
            if (createdAt >= weekAgo) studyGroupsCreated7d++;

            // Contar posts e comentários
            if (group.posts_data && Array.isArray(group.posts_data)) {
              groupPostsTotal += group.posts_data.length;
              group.posts_data.forEach((post: any) => {
                if (post.created_at) {
                  const postDate = new Date(post.created_at);
                  if (postDate >= yesterday) groupPostsCreated24h++;
                  if (postDate >= weekAgo) groupPostsCreated7d++;
                }
                if (post.comments && Array.isArray(post.comments)) {
                  groupCommentsTotal += post.comments.length;
                  post.comments.forEach((comment: any) => {
                    if (comment.created_at) {
                      const commentDate = new Date(comment.created_at);
                      if (commentDate >= yesterday) groupCommentsCreated24h++;
                      if (commentDate >= weekAgo) groupCommentsCreated7d++;
                    }
                  });
                }
              });
            }
          }
        });
      }

      const { count: totalMembers } = await supabase
        .from('study_group_members')
        .select('*', { count: 'exact', head: true });
      groupMembersTotal = totalMembers || 0;

      const { count: activeMembers } = await supabase
        .from('study_group_members')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      groupMembersActive = activeMembers || 0;

      const { count: pendingInvites } = await supabase
        .from('study_group_members')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'invited');
      groupMembersPendingInvitations = pendingInvites || 0;

      const { count: pendingRequests } = await supabase
        .from('study_group_members')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      groupMembersPendingRequests = pendingRequests || 0;
    } catch (error) {
      console.warn('[metrics] Error fetching study groups:', error);
    }

    // ============================================
    // 12. MÉTRICAS DE CONVERSÃO E ONBOARDING
    // ============================================
    let newUsers24h = 0;
    let newUsers7d = 0;
    let newUsers30d = 0;
    let growthRate = 0;
    let completedProfile = 0;
    let participatedRanking = 0;
    let createdStudyCycle = 0;
    let joinedGroup = 0;
    let d1Retention = 0;
    let d7Retention = 0;
    let d30Retention = 0;
    let churnRate = 0;

    try {
      const { count: new24h } = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday.toISOString());
      newUsers24h = new24h || 0;

      const { count: new7d } = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekAgo.toISOString());
      newUsers7d = new7d || 0;

      const { count: new30d } = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', thirtyDaysAgo.toISOString());
      newUsers30d = new30d || 0;

      // Calcular taxa de crescimento (comparar últimos 7 dias com 7 dias anteriores)
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const { count: previousWeek } = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', fourteenDaysAgo.toISOString())
        .lt('created_at', weekAgo.toISOString());
      
      if (previousWeek && previousWeek > 0) {
        growthRate = Math.round(((newUsers7d - previousWeek) / previousWeek) * 100 * 100) / 100;
      }

      // Engajamento inicial
      const { data: allUsers } = await supabase
        .from('users_profiles')
        .select('id, full_name, avatar_url');

      if (allUsers) {
        allUsers.forEach(user => {
          if (user.full_name && user.full_name.trim() !== '') completedProfile++;
        });
      }

      const { data: rankingsData } = await supabase
        .from('user_rankings')
        .select('user_id');
      if (rankingsData) {
        const uniqueUsers = new Set(rankingsData.map(r => r.user_id));
        participatedRanking = uniqueUsers.size;
      }

      const { data: cyclesData } = await supabase
        .from('study_cycles_v2')
        .select('user_id');
      if (cyclesData) {
        const uniqueUsers = new Set(cyclesData.map(c => c.user_id));
        createdStudyCycle = uniqueUsers.size;
      }

      const { data: groupsData } = await supabase
        .from('study_group_members')
        .select('user_id');
      if (groupsData) {
        const uniqueUsers = new Set(groupsData.map(g => g.user_id));
        joinedGroup = uniqueUsers.size;
      }

      // Retenção (simplificado - usuários que retornaram após X dias)
      const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
      const { count: activeD1 } = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .gte('last_activity', oneDayAgo.toISOString())
        .lt('created_at', oneDayAgo.toISOString());
      
      if (newUsers24h > 0) {
        d1Retention = Math.round((activeD1 || 0) / newUsers24h * 100 * 100) / 100;
      }

      const { count: activeD7 } = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .gte('last_activity', weekAgo.toISOString())
        .lt('created_at', weekAgo.toISOString());
      
      const sevenDaysAgoUsers = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString())
        .lt('created_at', weekAgo.toISOString());
      
      if (sevenDaysAgoUsers.count && sevenDaysAgoUsers.count > 0) {
        d7Retention = Math.round((activeD7 || 0) / sevenDaysAgoUsers.count * 100 * 100) / 100;
      }

      const { count: activeD30 } = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .gte('last_activity', thirtyDaysAgo.toISOString())
        .lt('created_at', thirtyDaysAgo.toISOString());
      
      const thirtyDaysAgoUsers = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString())
        .lt('created_at', thirtyDaysAgo.toISOString());
      
      if (thirtyDaysAgoUsers.count && thirtyDaysAgoUsers.count > 0) {
        d30Retention = Math.round((activeD30 || 0) / thirtyDaysAgoUsers.count * 100 * 100) / 100;
      }

      // Churn rate (usuários inativos há mais de 30 dias)
      const { count: inactiveUsers } = await supabase
        .from('users_profiles')
        .select('*', { count: 'exact', head: true })
        .lt('last_activity', thirtyDaysAgo.toISOString());
      
      if (totalUsers && totalUsers > 0) {
        churnRate = Math.round((inactiveUsers || 0) / totalUsers * 100 * 100) / 100;
      }
    } catch (error) {
      console.warn('[metrics] Error fetching conversion metrics:', error);
    }

    // ============================================
    // 13. MÉTRICAS DE RESPOSTAS DE PROVAS
    // ============================================
    let answersTotal = 0;
    let answersSubmitted24h = 0;
    let answersSubmitted7d = 0;
    let answersEditRate = 0;
    let answersByConcurso = 0;

    try {
      // Contar respostas consolidadas
      const { count: totalAnswers } = await supabase
        .from('consolidated_answers_by_concurso')
        .select('*', { count: 'exact', head: true });
      answersTotal = totalAnswers || 0;

      const { count: answers24h } = await supabase
        .from('consolidated_answers_by_concurso')
        .select('*', { count: 'exact', head: true })
        .gte('updated_at', yesterday.toISOString());
      answersSubmitted24h = answers24h || 0;

      const { count: answers7d } = await supabase
        .from('consolidated_answers_by_concurso')
        .select('*', { count: 'exact', head: true })
        .gte('updated_at', weekAgo.toISOString());
      answersSubmitted7d = answers7d || 0;

      // Contar concursos únicos com respostas
      const { data: answersData } = await supabase
        .from('consolidated_answers_by_concurso')
        .select('concurso_id');
      
      if (answersData) {
        const uniqueConcursos = new Set(answersData.map(a => a.concurso_id));
        answersByConcurso = uniqueConcursos.size;
      }

      // Taxa de edição (simplificado - baseado em updated_at diferente de created_at)
      const { data: allAnswers } = await supabase
        .from('consolidated_answers_by_concurso')
        .select('created_at, updated_at');
      
      if (allAnswers && allAnswers.length > 0) {
        const edited = allAnswers.filter(a => {
          if (!a.created_at || !a.updated_at) return false;
          return new Date(a.updated_at).getTime() > new Date(a.created_at).getTime() + 1000; // Mais de 1 segundo de diferença
        }).length;
        answersEditRate = Math.round((edited / allAnswers.length) * 100 * 100) / 100;
      }
    } catch (error) {
      console.warn('[metrics] Error fetching answers metrics:', error);
    }

    // ============================================
    // 14. MÉTRICAS DE CONCURSOS (MELHORADAS)
    // ============================================
    let concursosEmAndamento = 0;
    let concursosFinalizado = 0;
    let concursosInativo = 0;
    let concursosCreated24h = 0;
    let concursosCreated7d = 0;
    let concursosCreated30d = 0;
    let avgParticipationRate = 0;

    try {
      const { count: emAndamento } = await supabase
        .from('concursos')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Em andamento');
      concursosEmAndamento = emAndamento || 0;

      const { count: finalizado } = await supabase
        .from('concursos')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Finalizado');
      concursosFinalizado = finalizado || 0;

      const { count: inativo } = await supabase
        .from('concursos')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Inativo');
      concursosInativo = inativo || 0;

      const { count: created24h } = await supabase
        .from('concursos')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday.toISOString());
      concursosCreated24h = created24h || 0;

      const { count: created7d } = await supabase
        .from('concursos')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekAgo.toISOString());
      concursosCreated7d = created7d || 0;

      const { count: created30d } = await supabase
        .from('concursos')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', thirtyDaysAgo.toISOString());
      concursosCreated30d = created30d || 0;

      // Taxa média de participação
      const { data: allConcursos } = await supabase
        .from('concursos')
        .select('id, total_participants');
      
      if (allConcursos && allConcursos.length > 0) {
        const totalParticipants = allConcursos.reduce((sum, c) => sum + (c.total_participants || 0), 0);
        avgParticipationRate = Math.round((totalParticipants / allConcursos.length) * 100) / 100;
      }
    } catch (error) {
      console.warn('[metrics] Error fetching concursos metrics:', error);
    }

    // ============================================
    // 14b. FEED PCI (página /concursos)
    // ============================================
    let pciActiveCount = 0;
    let pciLastScrapedAt: string | null = null;
    let pciLastSync: MetricsResponse['metrics']['pci_feed']['last_sync'] = null;

    try {
      const { count: pciCount } = await supabase
        .from('pci_concurso_feed')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      pciActiveCount = pciCount || 0;

      const { data: pciScrapedRow } = await supabase
        .from('pci_concurso_feed')
        .select('scraped_at')
        .eq('is_active', true)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      pciLastScrapedAt = pciScrapedRow?.scraped_at ?? null;

      const { data: pciRunRow } = await supabase
        .from('pci_concurso_feed_sync_runs')
        .select('status, started_at, finished_at, items_upserted, items_deactivated, error_message')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pciRunRow) {
        pciLastSync = {
          status: pciRunRow.status,
          started_at: pciRunRow.started_at,
          finished_at: pciRunRow.finished_at,
          items_upserted: pciRunRow.items_upserted,
          items_deactivated: pciRunRow.items_deactivated,
          error_message: pciRunRow.error_message,
        };
      }
    } catch (error) {
      console.warn('[metrics] Error fetching pci_feed metrics:', error);
    }

    // ============================================
    // 15. MONTAR RESPOSTA
    // ============================================
    const response: MetricsResponse = {
      timestamp: now.toISOString(),
      status: 'ok',
      metrics: {
        users: {
          total: totalUsers || 0,
          online: onlineUsers || 0,
          active_24h: active24h || 0,
          active_7d: active7d || 0,
        },
        rankings: {
          total: totalRankings || 0,
          active: activeRankings || 0,
          participations: totalParticipations || 0,
          participations_24h: participations24h || 0,
        },
        scores: {
          average: Math.round(averageScore * 100) / 100,
          highest: Math.round(highestScore * 100) / 100,
          lowest: Math.round(lowestScore * 100) / 100,
          total_scored: totalScored,
        },
        studies: {
          total_cycles: totalCycles,
          active_cycles: activeCycles,
          total_sessions: totalSessions,
          total_hours: Math.round(totalHours * 100) / 100,
          questions_answered: questionsAnswered,
          correct_answers: correctAnswers,
          accuracy_rate: accuracyRate,
        },
        coach: {
          total_coaches: totalCoaches,
          active_subscriptions: activeSubscriptions,
          total_students: totalStudents,
          pending_invitations: pendingInvitations,
          access_logs_24h: accessLogs24h,
        },
        security: {
          audit_logs_24h: auditLogs24h,
          security_logs_24h: securityLogs24h,
          total_security_events: totalSecurityEvents,
        },
        notifications: {
          total: totalNotifications,
          unread: unreadNotifications,
          created_24h: notifications24h,
        },
        performance: {
          avg_query_time_ms: Math.round(avgQueryTime * 100) / 100,
          slow_queries_count: slowQueriesCount,
          active_alerts: activeAlertsCount,
          critical_alerts: criticalAlertsCount,
        },
        system: {
          health: systemHealth,
          engagement_rate: userEngagement,
          uptime_percentage: uptimePercentage,
        },
        subscriptions: {
          user_subscriptions: {
            total: userSubsTotal,
            free: userSubsFree,
            pro: userSubsPro,
            pro_active: userSubsProActive,
            active: userSubsActive,
            expiring_7d: userSubsExpiring7d,
            new_24h: userSubsNew24h,
            new_7d: userSubsNew7d,
            new_30d: userSubsNew30d,
          },
          coach_subscriptions: {
            total: coachSubsTotal,
            active: coachSubsActive,
            starter: coachSubsStarter,
            professional: coachSubsProfessional,
            enterprise: coachSubsEnterprise,
            expiring_7d: coachSubsExpiring7d,
          },
          vouchers: {
            total: vouchersTotal,
            active: vouchersActive,
            used: vouchersUsed,
            expiring_7d: vouchersExpiring7d,
          },
          payments: {
            pending: paymentsPending,
            approved_24h: paymentsApproved24h,
            approved_7d: paymentsApproved7d,
            rejected: paymentsRejected,
            success_rate: paymentSuccessRate,
          },
        },
        study_groups: {
          total: studyGroupsTotal,
          active: studyGroupsActive,
          archived: studyGroupsArchived,
          public: studyGroupsPublic,
          private: studyGroupsPrivate,
          invite_only: studyGroupsInviteOnly,
          total_members: studyGroupsTotalMembers,
          created_24h: studyGroupsCreated24h,
          created_7d: studyGroupsCreated7d,
          members: {
            total: groupMembersTotal,
            active: groupMembersActive,
            pending_invitations: groupMembersPendingInvitations,
            pending_requests: groupMembersPendingRequests,
          },
          posts: {
            total: groupPostsTotal,
            created_24h: groupPostsCreated24h,
            created_7d: groupPostsCreated7d,
          },
          comments: {
            total: groupCommentsTotal,
            created_24h: groupCommentsCreated24h,
            created_7d: groupCommentsCreated7d,
          },
        },
        conversion: {
          new_users: {
            registered_24h: newUsers24h,
            registered_7d: newUsers7d,
            registered_30d: newUsers30d,
            growth_rate: growthRate,
          },
          engagement: {
            completed_profile: completedProfile,
            participated_ranking: participatedRanking,
            created_study_cycle: createdStudyCycle,
            joined_group: joinedGroup,
          },
          retention: {
            d1_retention: d1Retention,
            d7_retention: d7Retention,
            d30_retention: d30Retention,
            churn_rate: churnRate,
          },
        },
        answers: {
          total_submitted: answersTotal,
          submitted_24h: answersSubmitted24h,
          submitted_7d: answersSubmitted7d,
          edit_rate: answersEditRate,
          by_concurso: answersByConcurso,
        },
        concursos: {
          by_status: {
            em_andamento: concursosEmAndamento,
            finalizado: concursosFinalizado,
            inativo: concursosInativo,
          },
          created: {
            created_24h: concursosCreated24h,
            created_7d: concursosCreated7d,
            created_30d: concursosCreated30d,
          },
          avg_participation_rate: avgParticipationRate,
        },
        pci_feed: {
          active_count: pciActiveCount,
          last_scraped_at: pciLastScrapedAt,
          last_sync: pciLastSync,
        },
      },
    };

    return new Response(
      JSON.stringify(response, null, 2),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    console.error('[metrics] Error:', error);
    
    const errorResponse: MetricsResponse = {
      timestamp: new Date().toISOString(),
      status: 'error',
      metrics: {
        users: { total: 0, online: 0, active_24h: 0, active_7d: 0 },
        rankings: { total: 0, active: 0, participations: 0, participations_24h: 0 },
        scores: { average: 0, highest: 0, lowest: 0, total_scored: 0 },
        studies: { total_cycles: 0, active_cycles: 0, total_sessions: 0, total_hours: 0, questions_answered: 0, correct_answers: 0, accuracy_rate: 0 },
        coach: { total_coaches: 0, active_subscriptions: 0, total_students: 0, pending_invitations: 0, access_logs_24h: 0 },
        security: { audit_logs_24h: 0, security_logs_24h: 0, total_security_events: 0 },
        notifications: { total: 0, unread: 0, created_24h: 0 },
        performance: { avg_query_time_ms: 0, slow_queries_count: 0, active_alerts: 0, critical_alerts: 0 },
        system: { health: 'critical', engagement_rate: 0, uptime_percentage: 0 },
        subscriptions: {
          user_subscriptions: { total: 0, free: 0, pro: 0, pro_active: 0, active: 0, expiring_7d: 0, new_24h: 0, new_7d: 0, new_30d: 0 },
          coach_subscriptions: { total: 0, active: 0, starter: 0, professional: 0, enterprise: 0, expiring_7d: 0 },
          vouchers: { total: 0, active: 0, used: 0, expiring_7d: 0 },
          payments: { pending: 0, approved_24h: 0, approved_7d: 0, rejected: 0, success_rate: 0 },
        },
        study_groups: {
          total: 0,
          active: 0,
          archived: 0,
          public: 0,
          private: 0,
          invite_only: 0,
          total_members: 0,
          created_24h: 0,
          created_7d: 0,
          members: { total: 0, active: 0, pending_invitations: 0, pending_requests: 0 },
          posts: { total: 0, created_24h: 0, created_7d: 0 },
          comments: { total: 0, created_24h: 0, created_7d: 0 },
        },
        conversion: {
          new_users: { registered_24h: 0, registered_7d: 0, registered_30d: 0, growth_rate: 0 },
          engagement: { completed_profile: 0, participated_ranking: 0, created_study_cycle: 0, joined_group: 0 },
          retention: { d1_retention: 0, d7_retention: 0, d30_retention: 0, churn_rate: 0 },
        },
        answers: { total_submitted: 0, submitted_24h: 0, submitted_7d: 0, edit_rate: 0, by_concurso: 0 },
        concursos: {
          by_status: { em_andamento: 0, finalizado: 0, inativo: 0 },
          created: { created_24h: 0, created_7d: 0, created_30d: 0 },
          avg_participation_rate: 0,
        },
        pci_feed: {
          active_count: 0,
          last_scraped_at: null,
          last_sync: null,
        },
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    return new Response(
      JSON.stringify(errorResponse, null, 2),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
