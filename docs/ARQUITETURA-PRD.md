# Nomeia Aí — Stack de produção

> VPS pública + Supabase e PostgreSQL no servidor local | Estado verificado em 19/11/2026

Este documento descreve a implantação observada em produção (PRD). É um retrato operacional da data acima, sem credenciais ou chaves privadas. HML e o frontend local são ambientes separados.

## 1. Fluxo de requisições

Usuário → HTTPS → Caddy na VPS (177.153.53.78) → Nginx da aplicação para nomeiai.com.br e www.nomeiai.com.br. Para api.nomeiai.com.br, Caddy → 10.77.0.2:8000 pela VPN WireGuard → Envoy no servidor local (192.168.0.241) → serviços Supabase → PostgreSQL e armazenamento locais.

A VPS usa 10.77.0.1/24 na interface wg0; o servidor local usa 10.77.0.2/24. O túnel de produção é WireGuard. O túnel SSH para acesso administrativo ao banco é outro mecanismo e não participa das requisições do site.

## 2. VPS: frontend e proxy

Host: vps73837, Ubuntu, IP público 177.153.53.78. Projeto Compose: nomeiai. Arquivos principais: /opt/nomeiai/compose.yaml, /opt/nomeiai/Caddyfile e /opt/nomeiai/dist/.

Containers ativos na inspeção: nomeiai-app-1 (Nginx, arquivos estáticos montados de ./dist somente para leitura no container) e nomeiai-caddy-1 (Caddy 2, portas públicas 80/TCP, 443/TCP e 443/UDP). Caddy gerencia HTTPS e encaminha as duas rotas descritas acima. O nome da imagem do app contém “test”, mas o Compose e os domínios observados correspondem à PRD; o conteúdo servido vem do volume dist.

Teste de 19/11: https://nomeiai.com.br/ respondeu HTTP 200. https://api.nomeiai.com.br/auth/v1/health chegou ao Envoy e respondeu HTTP 401 sem credenciais. O 401 confirma o encaminhamento, mas não valida autenticação ou fluxos funcionais completos.

## 3. Servidor local: API, banco e armazenamento

Host: servidor, LAN 192.168.0.241. Projeto Compose de PRD: supabase em /home/razum/supabase-nomeia-test/docker-compose.yml. Apesar do nome do diretório, este é o projeto que publica o gateway usado pela VPS. Existe HML distinto em /home/razum/supabase-nomeia-hml; não confundir os dois.

Serviços de PRD observados: api-gw (Envoy 1.39.6), auth (GoTrue 2.197.0), db (Supabase PostgreSQL 17.6), functions (Edge Runtime 1.77.9), imgproxy, meta, realtime, rest (PostgREST 14.18), storage, studio e supavisor. O gateway publica 8000/TCP em todas as interfaces do host. O Supavisor publica 5432 e 6543 somente em 127.0.0.1. O container PostgreSQL não publica sua porta diretamente no host.

Dados persistentes: /home/razum/supabase-nomeia-test/volumes/db/data (PostgreSQL), /home/razum/supabase-nomeia-test/volumes/storage (objetos) e /home/razum/supabase-nomeia-test/volumes/functions (Edge Functions). O arquivo de configuração do Envoy fica sob volumes/api/envoy. Guardar banco e storage juntos é necessário para restauração coerente da aplicação.

## 4. Acesso e operação

Acesso SSH à VPS a partir do Windows: ssh nomeia-vps-via-local. O alias usa ProxyJump via razum@192.168.0.241 e chave de VPS já autorizada. A restrição da chave no servidor local permite o salto para 177.153.53.78:22. Não registrar senhas, chaves privadas ou conteúdo de .env no Drive.

Verificar frontend na VPS: cd /opt/nomeiai && docker compose ps; curl -I https://nomeiai.com.br/; systemctl status wg-quick@wg0. Verificar API e banco no servidor local: docker compose -f /home/razum/supabase-nomeia-test/docker-compose.yml ps; docker exec supabase-db pg_isready -U supabase_admin -d postgres. Consultar logs com docker logs <container> --since 1h --tail 100.

Monitoramento: Zabbix e Grafana estão em stack separada no servidor local, em /home/razum/zabbix-monitoring/compose.yaml. O Zabbix Agent 2 também estava ativo na VPS. A existência desses serviços não substitui testes de login, leitura de dados, upload e Edge Functions após um deploy.

## 5. Publicação, backup e recuperação

O Compose da VPS monta /opt/nomeiai/dist no Nginx; a implantação atual não contém repositório Git em /opt/nomeiai nem uma referência explícita ao commit do frontend. Há cópias históricas em /opt/nomeiai/backup e /opt/nomeiai/backups, mas não foi verificada uma rotina de backup externo ou restauração testada. Antes de publicar, registrar commit, artefato, horário, responsável e procedimento de rollback; preservar uma cópia íntegra do dist anterior.

Para recuperação completa, planejar e testar backup do PostgreSQL, storage, funções, Compose, Caddyfile, configurações do Envoy e VPN, além de valores secretos guardados em cofre próprio. Não considerar as cópias na mesma VPS como proteção contra perda da própria VPS ou do servidor local.

## 6. Riscos e pendências

Prioridade alta: /opt/nomeiai/dist estava com permissão 777. Qualquer processo local pode alterar o conteúdo servido; reduzir permissões com um procedimento de deploy que mantenha a escrita apenas para a conta responsável.

Prioridade alta: o gateway Envoy de PRD publica 8000/TCP em 0.0.0.0 no servidor local. Revisar firewall e limitar a origem necessária para que a VPN seja o caminho de acesso previsto.

Disponibilidade: a PRD depende da VPS, do servidor local, da conexão entre eles e da VPN WireGuard. Uma falha no servidor local ou no túnel mantém o frontend no ar, mas interrompe a API.

Rastreabilidade: imagem do app nomeada como teste e tag latest, dist com bundles antigos misturados, ausência de commit identificado na pasta de implantação e ausência de healthchecks no Compose da VPS. Corrigir com build versionado, diretório de release imutável e checagem de saúde.

Não verificado nesta inspeção: política de backup externo, teste de restauração, regras efetivas de firewall, atualização automática de segurança, capacidade sob carga e fluxos de login/pagamento. Não tratar estes itens como aprovados sem validação específica.

## 7. Evidência da inspeção

Leitura direta em 19/11/2026 de docker compose ls, docker ps, Compose/Caddyfile da VPS, configuração efetiva do Compose local, interfaces WireGuard, volumes, respostas HTTPS, uso básico de recursos e conteúdo do bundle publicado. Nenhuma configuração de PRD foi alterada durante esta documentação.
